# Shuttle Sync frontend

React 18, TypeScript, and Vite. The product overview, API map, and local setup are in the repository root [README](../README.md).

```bash
npm ci
npm run dev
```

The dev server is `http://localhost:5173` and proxies `/api` to the API. Leave `VITE_API_URL` empty in `.env`. A production build is `npm run build`. The VPS serves the `dist` folder from the same origin as the API.
