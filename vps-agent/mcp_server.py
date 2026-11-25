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
from dataclasses import asdict
from pathlib import Path
from typing import Any

import uvicorn
from mcp.server.mcpserver import MCPServer
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
        "start_agent_task e depois get_agent_task. Diretorio de trabalho padrao: "
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
