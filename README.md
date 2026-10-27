# shuttle-sync-dotnet-react

## Screenshots

Light and dark shots of the home page, booking, login, profile, and dashboard, at 375 px and 1280 px wide, are saved by:

```bash
node scripts/showcase-screenshots.mjs
```

The app should already be running at `http://localhost:5173`. Set `SHUTTLE_SYNC_EMAIL` and `SHUTTLE_SYNC_PASSWORD` to include the profile and the dashboard. Without those, the script still saves the public pages. Files are written to `documentation/screenshots/` as `page-theme-width.png`, for example `home-dark-1280.png`.
