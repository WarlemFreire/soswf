"""Nucleo compartilhado: configuracao, log de auditoria e execucao do agente autonomo.

O agente autonomo e o Claude Agent SDK (o mesmo motor do Claude Code), rodando
na VPS como um usuario sem root, com permissao total dentro de AGENT_WORKDIR.
Usado pelo bot do Telegram, pelo servidor MCP (tarefas delegadas) e pelo cron.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import time
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ResultMessage,
    TextBlock,
    ToolUseBlock,
    query,
)


def _env(name: str, default: str | None = None) -> str:
    value = os.environ.get(name, default)
    if value is None:
        raise SystemExit(f"Variavel de ambiente obrigatoria ausente: {name}")
    return value


WORKDIR = Path(_env("AGENT_WORKDIR", str(Path.home() / "work"))).expanduser()
STATE_DIR = Path(_env("AGENT_STATE_DIR", str(Path.home() / ".vps-agent"))).expanduser()
MODEL = _env("AGENT_MODEL", "claude-opus-5-5")
MAX_BUDGET_USD = float(_env("AGENT_MAX_BUDGET_USD", "5"))
MAX_TURNS = int(_env("AGENT_MAX_TURNS", "60"))

SYSTEM_APPEND = (
    "Voce e um agente autonomo rodando numa VPS Linux do usuario, sem ninguem "
    "acompanhando em tempo real. Diretorio de trabalho: {workdir}. "
    "Execute a tarefa de ponta a ponta. Antes de qualquer acao destrutiva ou "
    "irreversivel (apagar dados, derrubar servicos, mexer em firewall/SSH), pare "
    "e explique no resultado o que faria, sem executar. Termine com um resumo "
    "curto do que foi feito, do que falhou e de como verificar."
)


def ensure_dirs() -> None:
    WORKDIR.mkdir(parents=True, exist_ok=True)
    STATE_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)


def audit(source: str, action: str, **data: Any) -> None:
    """Acrescenta uma linha JSON ao log de auditoria. Nunca levanta excecao."""
    try:
        ensure_dirs()
        entry = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "source": source, "action": action, **data}
        with open(STATE_DIR / "audit.jsonl", "a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry, ensure_ascii=False, default=str) + "\n")
    except Exception as exc:  # o log nao pode derrubar a tarefa
        print(f"[audit] falhou: {exc}", file=sys.stderr)


@dataclass
class AgentResult:
    ok: bool
    text: str
    session_id: str | None = None
    cost_usd: float | None = None
    turns: int = 0
    duration_s: float = 0.0
    tools_used: list[str] = field(default_factory=list)


async def run_agent(prompt: str, *, resume: str | None = None, source: str = "cli") -> AgentResult:
    """Roda uma tarefa no agente autonomo e devolve o resultado final."""
    ensure_dirs()
    options = ClaudeAgentOptions(
        cwd=str(WORKDIR),
        model=MODEL,
        permission_mode="bypassPermissions",
        max_turns=MAX_TURNS,
        max_budget_usd=MAX_BUDGET_USD,
        resume=resume,
        system_prompt={
            "type": "preset",
            "preset": "claude_code",
            "append": SYSTEM_APPEND.format(workdir=WORKDIR),
        },
    )
    audit(source, "agent_start", prompt=prompt, resume=resume)
    started = time.monotonic()
    tools: list[str] = []
    last_text = ""
    result: ResultMessage | None = None
    try:
        async for message in query(prompt=prompt, options=options):
            if isinstance(message, AssistantMessage):
                for block in message.content:
                    if isinstance(block, TextBlock) and block.text.strip():
                        last_text = block.text
                    elif isinstance(block, ToolUseBlock):
                        tools.append(block.name)
                        audit(source, "agent_tool", tool=block.name, input=block.input)
            elif isinstance(message, ResultMessage):
                result = message
    except Exception as exc:
        audit(source, "agent_error", error=repr(exc))
        return AgentResult(ok=False, text=f"Erro ao rodar o agente: {exc!r}", tools_used=tools,
                           duration_s=time.monotonic() - started)

    duration = time.monotonic() - started
    if result is None:
        out = AgentResult(ok=False, text=last_text or "O agente terminou sem resultado.",
                          tools_used=tools, duration_s=duration)
    else:
        text = result.result or last_text or ""
        if result.is_error:
            detail = "; ".join(result.errors or []) or result.subtype
            text = f"[{detail}] {text}".strip()
        out = AgentResult(
            ok=not result.is_error,
            text=text or "(sem texto final)",
            session_id=result.session_id,
            cost_usd=result.total_cost_usd,
            turns=result.num_turns,
            duration_s=duration,
            tools_used=tools,
        )
    audit(source, "agent_end", ok=out.ok, session_id=out.session_id, cost_usd=out.cost_usd,
          turns=out.turns, duration_s=round(duration, 1), result=out.text[:2000])
    return out


# ---------- Jobs em segundo plano (usados pelo servidor MCP) ----------

@dataclass
class Job:
    id: str
    prompt: str
    status: str = "running"  # running | done | error | cancelled
    created: float = field(default_factory=time.time)
    finished: float | None = None
    result: dict[str, Any] | None = None


class JobManager:
    """Roda tarefas do agente em segundo plano e guarda o resultado em disco."""

    def __init__(self, max_parallel: int = 2) -> None:
        self._jobs: dict[str, Job] = {}
        self._tasks: dict[str, asyncio.Task[None]] = {}
        self._sem = asyncio.Semaphore(max_parallel)
        self._dir = STATE_DIR / "jobs"

    def _save(self, job: Job) -> None:
        self._dir.mkdir(parents=True, exist_ok=True)
        (self._dir / f"{job.id}.json").write_text(json.dumps(asdict(job), ensure_ascii=False), encoding="utf-8")

    def start(self, prompt: str, resume: str | None = None) -> Job:
        job = Job(id=uuid.uuid4().hex[:12], prompt=prompt)
        self._jobs[job.id] = job
        self._save(job)
        self._tasks[job.id] = asyncio.create_task(self._run(job, resume))
        return job

    async def _run(self, job: Job, resume: str | None) -> None:
        try:
            async with self._sem:
                res = await run_agent(job.prompt, resume=resume, source=f"mcp-job:{job.id}")
            job.status = "done" if res.ok else "error"
            job.result = asdict(res)
        except asyncio.CancelledError:
            job.status = "cancelled"
            raise
        finally:
            job.finished = time.time()
            self._save(job)
            self._tasks.pop(job.id, None)

    def get(self, job_id: str) -> Job | None:
        if job_id in self._jobs:
            return self._jobs[job_id]
        path = self._dir / f"{job_id}.json"
        if path.is_file():
            return Job(**json.loads(path.read_text(encoding="utf-8")))
        return None

    def cancel(self, job_id: str) -> bool:
        task = self._tasks.get(job_id)
        if task is None:
            return False
        task.cancel()
        return True

    def recent(self, limit: int = 10) -> list[Job]:
        return sorted(self._jobs.values(), key=lambda j: j.created, reverse=True)[:limit]


def main() -> None:
    """Uso em cron:  python agent_core.py "tarefa"  (imprime o resultado)."""
    if len(sys.argv) < 2:
        raise SystemExit('uso: python agent_core.py "descricao da tarefa"')
    res = asyncio.run(run_agent(" ".join(sys.argv[1:]), source="cron"))
    print(res.text)
    print(f"\n-- ok={res.ok} custo=${res.cost_usd} turnos={res.turns} tempo={res.duration_s:.0f}s",
          file=sys.stderr)
    raise SystemExit(0 if res.ok else 1)


if __name__ == "__main__":
    main()
