"""Teste de fumaca do servidor MCP: sobe o servidor local e exercita auth e ferramentas.

Uso (de dentro de vps-agent/, com o venv ativo):  python tests/smoke_test.py
Nao chama o Claude: start_agent_task nao e exercitado aqui.
"""

from __future__ import annotations

import asyncio
import os
import secrets
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import httpx2
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

HERE = Path(__file__).resolve().parent.parent
PORT = 18765
TOKEN = secrets.token_urlsafe(48)


def start_server(tmp: Path) -> subprocess.Popen[bytes]:
    env = dict(os.environ, MCP_TOKEN=TOKEN, MCP_PORT=str(PORT), MCP_PUBLIC_HOST="vps.example.com",
               AGENT_WORKDIR=str(tmp / "work"), AGENT_STATE_DIR=str(tmp / "state"), MCP_CMD_TIMEOUT="5")
    proc = subprocess.Popen([sys.executable, "mcp_server.py"], cwd=HERE, env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    for _ in range(50):
        try:
            httpx2.get(f"http://127.0.0.1:{PORT}/", timeout=0.5)
            return proc
        except Exception:
            time.sleep(0.2)
    proc.kill()
    raise RuntimeError(proc.stderr.read().decode())


def check(cond: bool, label: str) -> None:
    print(("OK   " if cond else "FAIL ") + label)
    if not cond:
        raise SystemExit(1)


async def session_calls(url: str, headers: dict[str, str] | None = None) -> None:
    async with httpx2.AsyncClient(headers=headers or {}, timeout=30) as http:
        async with streamable_http_client(url, http_client=http) as streams:
            read, write = streams[0], streams[1]
            async with ClientSession(read, write) as s:
                await s.initialize()
                names = {t.name for t in (await s.list_tools()).tools}
                check({"run_command", "read_file", "write_file", "list_dir",
                       "start_agent_task", "get_agent_task"} <= names, f"lista de ferramentas ({len(names)})")

                r = await s.call_tool("run_command", {"command": "echo ola; echo erro >&2; exit 3"})
                sc = r.structured_content or {}
                check(sc.get("exit_code") == 3 and "ola" in sc.get("stdout", "") and "erro" in sc.get("stderr", ""),
                      "run_command devolve exit code, stdout e stderr")

                r = await s.call_tool("run_command", {"command": "sleep 30", "timeout_s": 1})
                check((r.structured_content or {}).get("timed_out") is True, "run_command respeita timeout")

                await s.call_tool("write_file", {"path": "teste/a.txt", "content": "abc"})
                r = await s.call_tool("read_file", {"path": "teste/a.txt"})
                check((r.structured_content or {}).get("content") == "abc", "write_file + read_file")

                r = await s.call_tool("get_agent_task", {"job_id": "naoexiste"})
                check("error" in (r.structured_content or {}), "get_agent_task com id invalido")


async def main() -> None:
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        proc = start_server(tmp)
        try:
            base = f"http://127.0.0.1:{PORT}"
            check(httpx2.post(f"{base}/mcp", json={}).status_code == 401, "sem token -> 401")
            check(httpx2.post(f"{base}/errado/mcp", json={}).status_code == 401, "token errado na URL -> 401")
            check(httpx2.post(f"{base}/mcp", json={}, headers={"Authorization": "Bearer x"}).status_code == 401,
                  "bearer errado -> 401")
            bad_host = httpx2.post(f"{base}/{TOKEN}/mcp", json={},
                                   headers={"Host": "evil.example", "Content-Type": "application/json"})
            check(bad_host.status_code == 421, "Host nao permitido -> 421")

            print("-- via URL secreta")
            await session_calls(f"{base}/{TOKEN}/mcp")
            print("-- via Authorization: Bearer")
            await session_calls(f"{base}/mcp", {"Authorization": f"Bearer {TOKEN}"})

            audit = (tmp / "state" / "audit.jsonl").read_text()
            check("run_command" in audit and "write_file" in audit, "log de auditoria gravado")
        finally:
            proc.terminate()
            proc.wait(5)
    print("\nTudo certo.")


if __name__ == "__main__":
    asyncio.run(main())
