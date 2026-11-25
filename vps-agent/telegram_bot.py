"""Bot do Telegram: voce manda a tarefa, o agente autonomo executa na VPS e responde.

Comandos:
  /start  - mostra o seu chat id e a ajuda
  /nova   - comeca uma conversa nova (esquece o contexto anterior)
  /status - diz se ha tarefa rodando
  /cancelar - interrompe a tarefa em andamento
Qualquer outra mensagem de texto vira uma tarefa, continuando a sessao anterior do chat.
So responde aos chats listados em TELEGRAM_ALLOWED_CHAT_IDS.
"""

from __future__ import annotations

import asyncio
import json
import os
import time

from telegram import Update
from telegram.constants import ChatAction
from telegram.ext import Application, CommandHandler, ContextTypes, MessageHandler, filters

import agent_core
from agent_core import STATE_DIR, audit, run_agent

TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
ALLOWED = {int(x) for x in os.environ.get("TELEGRAM_ALLOWED_CHAT_IDS", "").replace(" ", "").split(",") if x}
SESSIONS_FILE = STATE_DIR / "telegram_sessions.json"
TG_LIMIT = 4000

_running: dict[int, asyncio.Task[None]] = {}


def _load_sessions() -> dict[str, str]:
    try:
        return json.loads(SESSIONS_FILE.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _save_session(chat_id: int, session_id: str | None) -> None:
    data = _load_sessions()
    if session_id:
        data[str(chat_id)] = session_id
    else:
        data.pop(str(chat_id), None)
    SESSIONS_FILE.write_text(json.dumps(data), encoding="utf-8")


def _allowed(update: Update) -> bool:
    chat = update.effective_chat
    if chat is None or chat.id not in ALLOWED:
        audit("telegram", "denied", chat_id=chat.id if chat else None)
        return False
    return True


async def _send_long(context: ContextTypes.DEFAULT_TYPE, chat_id: int, text: str) -> None:
    for i in range(0, max(len(text), 1), TG_LIMIT):
        await context.bot.send_message(chat_id, text[i:i + TG_LIMIT] or "(vazio)")


async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    chat_id = update.effective_chat.id
    if chat_id not in ALLOWED:
        # Mostra o id para facilitar a configuracao, sem dar acesso a nada.
        await update.message.reply_text(f"Chat nao autorizado. Seu chat id: {chat_id}")
        audit("telegram", "denied_start", chat_id=chat_id)
        return
    await update.message.reply_text(__doc__ or "")


async def cmd_nova(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _allowed(update):
        return
    _save_session(update.effective_chat.id, None)
    await update.message.reply_text("Ok, proxima tarefa comeca do zero.")


async def cmd_status(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _allowed(update):
        return
    busy = update.effective_chat.id in _running
    await update.message.reply_text("Tarefa em andamento." if busy else "Nenhuma tarefa rodando.")


async def cmd_cancelar(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _allowed(update):
        return
    task = _running.get(update.effective_chat.id)
    if task is None:
        await update.message.reply_text("Nada para cancelar.")
        return
    task.cancel()
    await update.message.reply_text("Cancelando...")


async def _work(context: ContextTypes.DEFAULT_TYPE, chat_id: int, prompt: str) -> None:
    resume = _load_sessions().get(str(chat_id))

    async def typing_loop() -> None:
        while True:
            await context.bot.send_chat_action(chat_id, ChatAction.TYPING)
            await asyncio.sleep(5)

    typing = asyncio.create_task(typing_loop())
    try:
        res = await run_agent(prompt, resume=resume, source=f"telegram:{chat_id}")
        if res.session_id:
            _save_session(chat_id, res.session_id)
        cost = f"${res.cost_usd:.2f}" if res.cost_usd is not None else "?"
        footer = f"\n\n— {'ok' if res.ok else 'FALHOU'} · {res.turns} turnos · {res.duration_s:.0f}s · {cost}"
        await _send_long(context, chat_id, res.text + footer)
    except asyncio.CancelledError:
        await context.bot.send_message(chat_id, "Tarefa cancelada.")
        audit("telegram", "cancelled", chat_id=chat_id)
    finally:
        typing.cancel()
        _running.pop(chat_id, None)


async def on_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _allowed(update):
        return
    chat_id = update.effective_chat.id
    if chat_id in _running:
        await update.message.reply_text("Ja tem uma tarefa rodando. Use /cancelar ou espere terminar.")
        return
    prompt = update.message.text
    audit("telegram", "task", chat_id=chat_id, prompt=prompt)
    await update.message.reply_text(f"Recebido. Trabalhando ({time.strftime('%H:%M')})...")
    _running[chat_id] = asyncio.create_task(_work(context, chat_id, prompt))


def main() -> None:
    if not TOKEN:
        raise SystemExit("TELEGRAM_BOT_TOKEN ausente.")
    if not ALLOWED:
        raise SystemExit("TELEGRAM_ALLOWED_CHAT_IDS vazio: o bot nao responderia a ninguem.")
    agent_core.ensure_dirs()
    app = Application.builder().token(TOKEN).concurrent_updates(True).build()
    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("nova", cmd_nova))
    app.add_handler(CommandHandler("status", cmd_status))
    app.add_handler(CommandHandler("cancelar", cmd_cancelar))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, on_text))
    app.run_polling(drop_pending_updates=True)


if __name__ == "__main__":
    main()
