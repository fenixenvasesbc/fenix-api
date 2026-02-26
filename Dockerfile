FROM node:20-alpine

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

# ✅ genera el client de Prisma (clave para que existan Role/User en @prisma/client)
RUN pnpm prisma generate
RUN pnpm build

EXPOSE 3000
CMD ["node", "dist/main.js"]