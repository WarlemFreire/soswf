"""Servidor MCP remoto: expoe a VPS como ferramenta para o Claude (claude.ai e Claude Code).

Ferramentas:
  run_command      - executa um comando bash e devolve exit code, stdout e stderr
  read_file        - le um arquivo de texto
  write_file       - grava (ou acrescenta) um arquivo de texto
  list_dir         - lista um diretorio
  start_agent_task - delega uma tarefa longa ao agente autonomo da VPS (roda em segundo plano)
  get_agent_task   - consulta status/resultado de uma tarefa delegada
  cancel_agent_task

Autenticacao (uma das duas, comparacao em tempo constante):
  * URL secreta:  https://HOST/<MCP_TOKEN>/mcp   (para conectores do claude.ai)
  * Cabecalho:    Authorization: Bearer <MCP_TOKEN>  em https://HOST/mcp  (Claude Code CLI)

Escute so em 127.0.0.1 e publique via Caddy (HTTPS). Rode como usuario sem root.
"""

from __future__ import annotations

import asyncio
import hmac
import json
import os
import signal
import time
from dataclasses import asdict
from pathlib import Path
from typing import Any

import httpx2
import uvicorn
from starlette.responses import RedirectResponse, Response
from mcp.server.mcpserver import Image, MCPServer
from mcp.server.transport_security import TransportSecuritySettings

import agent_core
from agent_core import WORKDIR, JobManager, audit

TOKEN = os.environ.get("MCP_TOKEN", "")
PUBLIC_HOST = os.environ.get("MCP_PUBLIC_HOST", "")
BIND = os.environ.get("MCP_BIND", "127.0.0.1")
PORT = int(os.environ.get("MCP_PORT", "8765"))
CMD_TIMEOUT = int(os.environ.get("MCP_CMD_TIMEOUT", "120"))
CMD_TIMEOUT_MAX = int(os.environ.get("MCP_CMD_TIMEOUT_MAX", "1800"))
MAX_OUTPUT = 60_000  # caracteres por stream devolvidos ao modelo

mcp = MCPServer(
    "vps",
    instructions=(
        "Acesso a uma VPS Linux do usuario. Use run_command para tarefas curtas "
        "(ate alguns minutos). Para tarefas longas ou de varias etapas, use "
        "start_agent_task e depois get_agent_task. Para ver paginas da web use "
        "screenshot (devolve a imagem) e browse_page (texto/estrutura); para ver uma "
        "imagem que ja esta na VPS use read_image. Diretorio de trabalho padrao: "
        f"{WORKDIR}. Nao rode comandos destrutivos sem o usuario pedir."
    ),
)

_jobs: JobManager | None = None


def jobs() -> JobManager:
    global _jobs
    if _jobs is None:  # criado dentro do event loop do servidor
        _jobs = JobManager()
    return _jobs


def _resolve(path: str) -> Path:
    p = Path(path).expanduser()
    return p if p.is_absolute() else WORKDIR / p


def _clip(text: str) -> str:
    if len(text) <= MAX_OUTPUT:
        return text
    half = MAX_OUTPUT // 2
    return f"{text[:half]}\n\n... [{len(text) - MAX_OUTPUT} caracteres cortados] ...\n\n{text[-half:]}"


@mcp.tool()
async def run_command(command: str, cwd: str | None = None, timeout_s: int | None = None) -> dict[str, Any]:
    """Executa um comando no bash da VPS e devolve exit_code, stdout e stderr.

    cwd: diretorio (padrao: diretorio de trabalho do agente). timeout_s: limite em segundos.
    """
    timeout = max(1, min(timeout_s or CMD_TIMEOUT, CMD_TIMEOUT_MAX))
    workdir = _resolve(cwd) if cwd else WORKDIR
    audit("mcp", "run_command", command=command, cwd=str(workdir), timeout_s=timeout)
    proc = await asyncio.create_subprocess_exec(
        "bash", "-lc", command,
        cwd=str(workdir),
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        start_new_session=True,  # permite matar o grupo inteiro no timeout
    )
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        timed_out = False
    except asyncio.TimeoutError:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        out, err = await proc.communicate()
        timed_out = True
    result = {
        "exit_code": proc.returncode,
        "timed_out": timed_out,
        "stdout": _clip(out.decode("utf-8", "replace")),
        "stderr": _clip(err.decode("utf-8", "replace")),
    }
    audit("mcp", "run_command_end", exit_code=proc.returncode, timed_out=timed_out)
    return result


@mcp.tool()
def read_file(path: str, max_chars: int = 200_000) -> dict[str, Any]:
    """Le um arquivo de texto da VPS. Caminho relativo e resolvido a partir do diretorio de trabalho."""
    p = _resolve(path)
    audit("mcp", "read_file", path=str(p))
    data = p.read_text(encoding="utf-8", errors="replace")
    return {"path": str(p), "size": len(data), "truncated": len(data) > max_chars, "content": data[:max_chars]}


@mcp.tool()
def write_file(path: str, content: str, append: bool = False) -> dict[str, Any]:
    """Grava um arquivo de texto na VPS (cria diretorios). append=True acrescenta ao final."""
    p = _resolve(path)
    audit("mcp", "write_file", path=str(p), chars=len(content), append=append)
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "a" if append else "w", encoding="utf-8") as fh:
        fh.write(content)
    return {"path": str(p), "bytes": p.stat().st_size}


@mcp.tool()
def list_dir(path: str = ".") -> list[dict[str, Any]]:
    """Lista um diretorio da VPS (nome, tipo, tamanho)."""
    p = _resolve(path)
    audit("mcp", "list_dir", path=str(p))
    entries = []
    for child in sorted(p.iterdir(), key=lambda c: c.name)[:1000]:
        try:
            st = child.lstat()
            kind = "dir" if child.is_dir() else "link" if child.is_symlink() else "file"
            entries.append({"name": child.name, "type": kind, "size": st.st_size})
        except OSError as exc:
            entries.append({"name": child.name, "type": "?", "error": str(exc)})
    return entries


BROWSER_DIR = Path(os.environ.get("BROWSER_DIR", str(Path.home() / "tools" / "browser")))
NAV = BROWSER_DIR / "nav.js"
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
MAX_RAW_IMAGE = 3_500_000  # sem Pillow, so devolve imagens ate esse tamanho


def _image_for_model(path: Path, max_side: int = 1568) -> Image:
    """Le uma imagem do disco e a devolve ao modelo, reduzindo se for grande."""
    if path.suffix.lower() not in IMAGE_EXT:
        raise ValueError(f"extensao nao suportada: {path.suffix} (use {', '.join(sorted(IMAGE_EXT))})")
    if not path.is_file():
        raise FileNotFoundError(str(path))
    try:
        from PIL import Image as PILImage  # opcional
    except ImportError:
        if path.stat().st_size > MAX_RAW_IMAGE:
            raise ValueError("imagem grande e o Pillow nao esta instalado para reduzi-la")
        return Image(path=path)
    import io
    with PILImage.open(path) as im:
        im.seek(0)
        if im.mode not in ("RGB", "L"):
            im = im.convert("RGB")
        im.thumbnail((max_side, max_side))
        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=85)
    return Image(data=buf.getvalue(), format="jpeg")


async def _run_nav(args: list[str], timeout: int) -> tuple[int, str, str]:
    if not NAV.is_file():
        raise FileNotFoundError(f"{NAV} nao existe (instale o navegador, veja o README)")
    proc = await asyncio.create_subprocess_exec(
        "node", str(NAV), *args, cwd=str(BROWSER_DIR),
        stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        start_new_session=True)
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        await proc.communicate()
        raise TimeoutError(f"navegador excedeu {timeout}s")
    return proc.returncode or 0, out.decode("utf-8", "replace"), err.decode("utf-8", "replace")


def _check_url(url: str) -> None:
    if not url.lower().startswith(("http://", "https://")):
        raise ValueError("so URLs http(s) sao permitidas")


@mcp.tool()
def read_image(path: str, max_side: int = 1568) -> Image:
    """Mostra ao modelo uma imagem (png/jpg/gif/webp) que esta na VPS. Imagens grandes sao reduzidas."""
    p = _resolve(path)
    audit("mcp", "read_image", path=str(p))
    return _image_for_model(p, max(256, min(max_side, 2576)))


@mcp.tool()
async def screenshot(url: str, full_page: bool = False, width: int = 1280, height: int = 800,
                     wait_ms: int = 1500, profile: str | None = None) -> Image:
    """Abre a pagina num navegador (Chromium) na VPS e devolve a captura de tela como imagem.

    full_page=True captura a pagina inteira. profile guarda cookies/login entre chamadas.
    """
    _check_url(url)
    audit("mcp", "screenshot", url=url, full_page=full_page, profile=profile)
    shots = WORKDIR / "shots"
    shots.mkdir(parents=True, exist_ok=True)
    out = shots / f"{int(time.time())}.jpg"
    args = ["shot", url, str(out), "--width", str(width), "--height", str(height), "--wait", str(wait_ms)]
    if full_page:
        args.append("--full")
    if profile:
        args += ["--profile", profile]
    code, so, se = await _run_nav(args, 120)
    if code != 0 or not out.is_file():
        raise RuntimeError((se or so).strip()[:500] or f"falhou (codigo {code})")
    return _image_for_model(out)


@mcp.tool()
async def browse_page(url: str, mode: str = "text", wait_ms: int = 1500, profile: str | None = None) -> str:
    """Abre a pagina num navegador na VPS e devolve texto. mode: text | snapshot (estrutura) | links."""
    _check_url(url)
    if mode not in ("text", "snapshot", "links"):
        raise ValueError("mode deve ser text, snapshot ou links")
    audit("mcp", "browse_page", url=url, mode=mode, profile=profile)
    args = [mode, url, "--wait", str(wait_ms)] + (["--profile", profile] if profile else [])
    code, so, se = await _run_nav(args, 120)
    if code != 0:
        raise RuntimeError((se or so).strip()[:500] or f"falhou (codigo {code})")
    return _clip(so)


# --- "Janela de login" do Instagram: encaminha para o ig_window.js (so escuta em 127.0.0.1) ---
WINDOW_PORT = int(os.environ.get("IG_WINDOW_PORT", "8770"))


@mcp.custom_route("/ig-window/{rest:path}", methods=["GET", "POST"])
async def ig_window_proxy(request):  # type: ignore[no-untyped-def]
    rest = request.path_params.get("rest", "")
    body = await request.body() if request.method == "POST" else None
    try:
        async with httpx2.AsyncClient(timeout=20) as client:
            r = await client.request(
                request.method, f"http://127.0.0.1:{WINDOW_PORT}/{rest}", params=dict(request.query_params),
                content=body, headers={"content-type": request.headers.get("content-type", "application/json")})
    except Exception:
        return Response("A janela de login nao esta aberta.", status_code=503)
    return Response(r.content, status_code=r.status_code, media_type=r.headers.get("content-type"),
                    headers={"cache-control": "no-store"})


@mcp.tool()
async def start_agent_task(task: str, resume_session_id: str | None = None) -> dict[str, Any]:
    """Delega uma tarefa longa ao agente autonomo da VPS, que roda em segundo plano.

    Devolve um job_id; consulte com get_agent_task. resume_session_id continua uma sessao anterior.
    """
    job = jobs().start(task, resume=resume_session_id)
    audit("mcp", "start_agent_task", job_id=job.id, task=task)
    return {"job_id": job.id, "status": job.status}


@mcp.tool()
async def get_agent_task(job_id: str) -> dict[str, Any]:
    """Consulta status e resultado de uma tarefa delegada (running, done, error, cancelled)."""
    job = jobs().get(job_id)
    if job is None:
        return {"error": f"job {job_id} nao encontrado"}
    return asdict(job)


@mcp.tool()
async def cancel_agent_task(job_id: str) -> dict[str, Any]:
    """Cancela uma tarefa delegada que ainda esteja rodando."""
    ok = jobs().cancel(job_id)
    audit("mcp", "cancel_agent_task", job_id=job_id, ok=ok)
    return {"cancelled": ok}


class TokenAuth:
    """ASGI: aceita /<token>/mcp (reescreve para /mcp) ou Authorization: Bearer <token>."""

    def __init__(self, app: Any, token: str) -> None:
        self.app = app
        self.token = token.encode()

    def _ok(self, candidate: str) -> bool:
        return hmac.compare_digest(candidate.encode(), self.token)

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope["type"] != "http":  # lifespan etc.
            return await self.app(scope, receive, send)

        path: str = scope.get("path", "")
        if path.startswith("/ig-window/"):  # protegida pela chave descartavel da propria janela
            return await self.app(scope, receive, send)
        parts = path.split("/", 2)  # ['', '<token>', 'mcp...']
        if len(parts) == 3 and self._ok(parts[1]):
            new_path = "/" + parts[2]
            scope = dict(scope, path=new_path, raw_path=new_path.encode())
            return await self.app(scope, receive, send)

        headers = dict(scope.get("headers") or [])
        auth = headers.get(b"authorization", b"").decode("latin-1")
        if auth.lower().startswith("bearer ") and self._ok(auth[7:].strip()):
            return await self.app(scope, receive, send)

        body = json.dumps({"error": "unauthorized"}).encode()
        await send({"type": "http.response.start", "status": 401,
                    "headers": [(b"content-type", b"application/json"),
                                (b"content-length", str(len(body)).encode())]})
        await send({"type": "http.response.body", "body": body})


def build_app() -> Any:
    if len(TOKEN) < 32:
        raise SystemExit("MCP_TOKEN ausente ou curto demais (minimo 32 caracteres).")
    allowed = [f"{BIND}:{PORT}", f"localhost:{PORT}", f"127.0.0.1:{PORT}"]
    if PUBLIC_HOST:
        allowed += [PUBLIC_HOST, f"{PUBLIC_HOST}:443"]
    security = TransportSecuritySettings(
        enable_dns_rebinding_protection=True,
        allowed_hosts=allowed,
        allowed_origins=["https://claude.ai", "https://claude.com"] + ([f"https://{PUBLIC_HOST}"] if PUBLIC_HOST else []),
    )
    inner = mcp.streamable_http_app(streamable_http_path="/mcp", transport_security=security, host=BIND)
    return TokenAuth(inner, TOKEN)


def main() -> None:
    agent_core.ensure_dirs()
    uvicorn.run(build_app(), host=BIND, port=PORT, proxy_headers=True, log_level="info")


if __name__ == "__main__":
    main()
