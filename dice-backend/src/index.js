require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");

const walletRoutes = require("./routes/walletRoutes");
const lobbyRoutes = require("./routes/lobbyRoutes");

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// ---- API ROUTES ----
app.use("/api/wallet", walletRoutes);
app.use("/api/lobbies", lobbyRoutes);

// Optional: health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "Dice backend running" });
});

// ---- Serve frontend build ----
const frontendDistPath = path.join(
  __dirname,
  "..",
  "..",
  "dice-frontend",
  "dist"
);

// Serve static files from React build
app.use(express.static(frontendDistPath));

// SPA fallback for any NON-API route:
// we do NOT pass a path string here (no "*" / "/*"), so path-to-regexp is happy.
app.use((req, res, next) => {
  if (req.path.startsWith("/api")) {
    return next();
  }

  res.sendFile(path.join(frontendDistPath, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Dice backend listening on port ${PORT}`);
});
