#!/usr/bin/env bash
# Instala o vps-agent numa VPS Debian/Ubuntu. Rode como root, de dentro da pasta vps-agent:
#   sudo bash deploy/install.sh
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)"
APP=/opt/vps-agent

apt-get update -y
apt-get install -y python3 python3-venv curl

# Usuario sem root para o agente
id agente >/dev/null 2>&1 || adduser --disabled-password --gecos "" agente
install -d -o agente -g agente /home/agente/work

# Codigo + venv
install -d "$APP"
cp "$SRC"/*.py "$SRC"/requirements.txt "$APP"/
python3 -m venv "$APP/venv"
"$APP/venv/bin/pip" install -q --upgrade pip
"$APP/venv/bin/pip" install -q -r "$APP/requirements.txt"
chown -R agente:agente "$APP"

# Claude Code CLI para o usuario agente (o Agent SDK usa por baixo)
su - agente -c 'curl -fsSL https://claude.ai/install.sh | bash'

# Arquivo de configuracao (so cria se nao existir)
if [ ! -f /etc/vps-agent.env ]; then
  install -m 600 -o root -g root "$SRC/.env.example" /etc/vps-agent.env
  TOKEN="$(python3 -c 'import secrets;print(secrets.token_urlsafe(48))')"
  sed -i "s|^MCP_TOKEN=.*|MCP_TOKEN=$TOKEN|" /etc/vps-agent.env
  echo ">> Criado /etc/vps-agent.env com um MCP_TOKEN novo. Edite o resto antes de iniciar."
fi

# HTTPS: por padrao NAO instala servidor web (use o Nginx Proxy Manager que ja esta na VPS).
# Numa VPS limpa, sem nada nas portas 80/443, rode:  INSTALL_CADDY=1 bash deploy/install.sh
if [ "${INSTALL_CADDY:-0}" = "1" ] && ! command -v caddy >/dev/null; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi

install -m 644 "$SRC/deploy/vps-mcp.service" "$SRC/deploy/vps-telegram.service" /etc/systemd/system/
systemctl daemon-reload

cat <<MSG

Pronto. Proximos passos:
  1. nano /etc/vps-agent.env          (credencial do Claude, dominio, Telegram)
  2. No Nginx Proxy Manager: crie o Proxy Host (veja README, secao Nginx Proxy Manager)
  3. systemctl enable --now vps-mcp vps-telegram
  4. journalctl -u vps-mcp -u vps-telegram -f
MSG
