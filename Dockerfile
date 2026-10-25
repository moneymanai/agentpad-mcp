# Minimal image for the AgentPad MCP server (stdio). No secrets needed: it only reads Base mainnet and returns UNSIGNED txs.
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production \
    AGENTPAD_API=https://agentpad.thevibehosting.com \
    BASE_RPC_URL=https://mainnet.base.org
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY server.mjs AgentPad.abi.json AgentPadV2.abi.json RoadmapVault.abi.json ./
USER node
# MCP over stdio: the client talks JSON-RPC on stdin/stdout.
ENTRYPOINT ["node", "server.mjs"]
