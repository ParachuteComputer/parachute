# The push gateway (README.md). Node runs the TypeScript as it is (type stripping); one dependency, nostr-tools.
FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY src ./src
# the registrations volume is the node user's (a fresh named volume takes this folder's owner)
RUN mkdir /data && chown node:node /data
USER node
ENV PUSH_GATEWAY_BIND=0.0.0.0 PUSH_GATEWAY_PORT=8790 PUSH_GATEWAY_DATA=/data
EXPOSE 8790
CMD ["node", "src/main.ts"]
