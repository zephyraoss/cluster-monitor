# cluster-monitor

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

To build:

```bash
docker buildx build --platform linux/amd64 -t cluster-monitor:latest --load .
docker buildx build --platform linux/arm64 -t cluster-monitor:latest --load .
```

This project was created using `bun init` in bun v1.3.5. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
