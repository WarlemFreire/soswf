# vps-agent

Transforma sua VPS em duas coisas ao mesmo tempo:

1. **Uma ferramenta do Claude (conector MCP).** Em qualquer conversa no claude.ai ou no Claude Code, o Claude pode rodar comandos, ler e gravar arquivos na VPS, e delegar tarefas longas ao agente autônomo.
2. **Um agente autônomo (bot do Telegram e cron).** Você manda uma tarefa pelo Telegram e o agente (Claude Agent SDK, o mesmo motor do Claude Code) executa na VPS sozinho, sem pedir aprovação, e responde quando termina.

```
claude.ai / Claude Code ──HTTPS──▶ Caddy ──▶ mcp_server.py ──┬─▶ bash / arquivos
                                                             └─▶ start_agent_task ─┐
Telegram ─────────────────────────────▶ telegram_bot.py ──────────────────────────┤
cron ──────────────────────────────────▶ agent_core.py ───────────────────────────┴─▶ Claude Agent SDK
```

Tudo roda como o usuário `agente`, sem root, e cada ação vai para `~/.vps-agent/audit.jsonl`.

## O que foi testado

- `tests/smoke_test.py`: autenticação por URL secreta e por `Bearer` (token errado dá 401; `Host` desconhecido dá 421), `run_command` com exit code, stdout, stderr e timeout, `write_file`/`read_file`, e o log de auditoria.
- Teste de ponta a ponta: o MCP chamou `start_agent_task`, o agente executou com a ferramenta Bash, e `get_agent_task` devolveu o resultado. Custou cerca de US$ 0,17. Um "diga oi" custa cerca de US$ 0,22, porque o prompt de sistema do Claude Code é grande.
- O bot do Telegram **não** foi testado contra o Telegram real, porque precisa do seu token. O código carrega e as travas de configuração foram verificadas.

## Pré-requisitos

- VPS Debian ou Ubuntu, com acesso root.
- Um domínio (ou subdomínio) com registro A apontando para o IP da VPS, por exemplo `vps.seudominio.com`.
- Portas 80 e 443 abertas, para o HTTPS automático do Caddy.
- Uma credencial do Claude para o agente:
  - **API key** (`ANTHROPIC_API_KEY`), com cobrança por uso; **ou**
  - **token da sua assinatura**: rode `sudo -iu agente claude setup-token` na VPS e coloque o resultado em `CLAUDE_CODE_OAUTH_TOKEN`.
- Para o bot: um token criado no @BotFather e o seu chat id (consulte o @userinfobot).

## Instalação

```bash
# na VPS, como root
git clone <este repositório> && cd soswf/vps-agent
bash deploy/install.sh               # cria o usuário agente, o venv, o Claude Code, o Caddy e os serviços
nano /etc/vps-agent.env               # preencha a credencial, MCP_PUBLIC_HOST e o Telegram
cp deploy/Caddyfile /etc/caddy/Caddyfile && nano /etc/caddy/Caddyfile   # troque o domínio
systemctl reload caddy
systemctl enable --now vps-mcp vps-telegram
journalctl -u vps-mcp -u vps-telegram -f
```

O `install.sh` gera um `MCP_TOKEN` aleatório. Para ver o token: `grep MCP_TOKEN /etc/vps-agent.env`.

## Nginx Proxy Manager (VPS que já tem Docker em 80/443)

Se as portas 80/443 já são do Nginx Proxy Manager (NPM), **não use o Caddy**. O instalador não o instala por padrão.

1. Aponte o DNS: registro `A`, nome `vps`, valor = IP da VPS.
2. O `MCP_BIND` no `/etc/vps-agent.env` deve ser o endereço da VPS na rede docker do NPM. Descubra com:
   `docker inspect nginx-proxy-app-1 --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{$v.Gateway}}{{"\n"}}{{end}}'`
   (use o gateway de `nginx-proxy_default`).
3. No painel do NPM, em **Proxy Hosts → Add**:
   - Domain: `vps.soswf.com.br`
   - Scheme `http`, Forward Hostname/IP = o `MCP_BIND`, Port `8765`
   - Ative **Websockets Support**
   - Aba SSL: novo certificado Let's Encrypt, **Force SSL** ligado
   - Aba Advanced, para o streaming do MCP: `proxy_buffering off; proxy_read_timeout 3600s;`
4. Teste: `curl -i https://vps.soswf.com.br/mcp` deve dar `401` (sem token). Qualquer outra resposta, revise.

## Conectar ao Claude

**claude.ai (web, desktop e celular).** Vá em Configurações → Conectores → Adicionar conector personalizado, e use a URL:

```
https://vps.seudominio.com/<MCP_TOKEN>/mcp
```

Na janela de permissões do conector, escolha "sempre permitir" nas ferramentas em que você confia. Sem isso, cada chamada pede aprovação.

**Claude Code (terminal).** Use o token no cabecalho, que não fica gravado na URL:

```bash
claude mcp add --transport http vps https://vps.seudominio.com/mcp \
  --header "Authorization: Bearer <MCP_TOKEN>"
```

Depois disso, peça normalmente, por exemplo "veja o uso de disco da VPS", e o Claude chama `run_command`. Para tarefas longas, ele usa `start_agent_task`, e você pode perguntar o status depois.

## Usar o bot do Telegram

- Qualquer texto vira uma tarefa, e a conversa continua com o contexto da anterior.
- `/nova` zera o contexto, `/status` mostra se há tarefa rodando, `/cancelar` interrompe.
- No fim de cada tarefa, o bot mostra se deu certo, o número de turnos, o tempo e o custo.

## Tarefas agendadas (cron)

```bash
sudo -iu agente crontab -e
# todo dia às 7h: relatório de saúde da VPS no log
0 7 * * * set -a; . /etc/vps-agent.env; set +a; cd /opt/vps-agent && venv/bin/python agent_core.py "Verifique disco, memória, serviços com falha e atualizações pendentes. Resuma." >> /home/agente/cron.log 2>&1
```

Atenção: `/etc/vps-agent.env` tem permissão 600 e pertence ao root. Para o cron do `agente` conseguir ler, ou dê `chown agente` nesse arquivo, ou crie uma cópia só com as variáveis do agente.

## Segurança: leia antes de ligar

O que está implementado:
- **Execução remota de código é o objetivo.** Quem tiver o `MCP_TOKEN` ou acesso ao seu Telegram controla a VPS, dentro do que o usuário `agente` pode fazer. Trate o token como uma senha root.
- **Sem root.** Não coloque o `agente` no grupo `sudo`. Se precisar, libere comandos específicos em `/etc/sudoers.d/agente`. O Claude Code também se recusa a rodar sem permissões como root.
- **Token na URL.** É o que o conector do claude.ai aceita sem OAuth. O Caddyfile descarta o log de acesso para o token não ficar em disco. Se ele vazar, troque `MCP_TOKEN` e reinicie: `systemctl restart vps-mcp`.
- **O servidor só escuta em 127.0.0.1.** Só o Caddy fica exposto.
- **Teto de gasto.** `AGENT_MAX_BUDGET_USD` (US$ 5 por padrão) e `AGENT_MAX_TURNS` limitam cada tarefa.
- **Auditoria.** Cada comando, arquivo e chamada do agente fica em `/home/agente/.vps-agent/audit.jsonl`.

O que **não** está implementado e vale considerar:
- OAuth de verdade no MCP. Uma opção é colocar Cloudflare Access na frente.
- Restringir o acesso aos IPs de saída da Anthropic no firewall.
- Snapshots automáticos da VPS, configurados no seu provedor.
