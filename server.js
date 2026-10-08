
const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const { createClient } = require("redis");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

const LEADERBOARD_KEY = "leaderboard";
const CHANNEL = "leaderboard:updates";
const TOP_LIMIT = 10;

const redis = createClient({ url: REDIS_URL });

redis.on("error", (error) => {
  console.error("Redis error:", error.message);
});

app.use(express.json({ limit: "10kb" }));
app.use(express.static(path.join(__dirname, "public")));

// Get the top 10 players
async function getLeaderboard() {
  const players = await redis.zRangeWithScores(
    LEADERBOARD_KEY,
    0,
    TOP_LIMIT - 1,
    { REV: true }
  );

  return players.map((player, index) => ({
    rank: index + 1,
    name: player.value,
    score: player.score,
  }));
}

// Health check
app.get("/api/health", async (req, res) => {
  try {
    await redis.ping();
    res.json({ status: "ok", redis: "connected" });
  } catch (error) {
    res.status(503).json({
      status: "error",
      redis: "disconnected",
    });
  }
});

// Get leaderboard
app.get("/api/leaderboard", async (req, res) => {
  try {
    res.json(await getLeaderboard());
  } catch (error) {
    console.error("Leaderboard error:", error);
    res.status(500).json({
      error: "Could not load leaderboard",
    });
  }
});

// Add points to a player
app.post("/api/score", async (req, res) => {
  try {
    const { name, points } = req.body || {};

    if (
      typeof name !== "string" ||
      !name.trim() ||
      name.trim().length > 30
    ) {
      return res.status(400).json({
        error: "Player name must contain 1–30 characters",
      });
    }

    if (
      !Number.isSafeInteger(points) ||
      points < 1 ||
      points > 1000
    ) {
      return res.status(400).json({
        error: "Points must be an integer from 1 to 1000",
      });
    }

    const playerName = name.trim();

    const score = await redis.zIncrBy(
      LEADERBOARD_KEY,
      points,
      playerName
    );

    // Notify all connected dashboards
    await redis.publish(
      CHANNEL,
      JSON.stringify({ type: "LEADERBOARD_UPDATED" })
    );

    res.json({
      message: "Score updated successfully",
      player: playerName,
      score: Number(score),
    });
  } catch (error) {
    console.error("Score update error:", error);
    res.status(500).json({
      error: "Could not update score",
    });
  }
});

// Delete a player and their score
app.delete("/api/players/:name", async (req, res) => {
  try {
    const playerName = req.params.name;

    if (!playerName || playerName.trim().length > 30) {
      return res.status(400).json({
        error: "Invalid player name",
      });
    }

    const removed = await redis.zRem(
      LEADERBOARD_KEY,
      playerName
    );

    if (removed === 0) {
      return res.status(404).json({
        error: "Player not found",
      });
    }

    // Notify every connected browser
    await redis.publish(
      CHANNEL,
      JSON.stringify({
        type: "PLAYER_DELETED",
        player: playerName,
      })
    );

    res.json({
      message: "Player deleted successfully",
      player: playerName,
    });
  } catch (error) {
    console.error("Delete player error:", error);
    res.status(500).json({
      error: "Could not delete player",
    });
  }
});

// Socket.IO connections
io.on("connection", async (socket) => {
  console.log("Browser connected:", socket.id);

  try {
    socket.emit("leaderboard:update", await getLeaderboard());
  } catch (error) {
    console.error("Initial leaderboard error:", error);
  }

  socket.on("disconnect", () => {
    console.log("Browser disconnected:", socket.id);
  });
});

// Connect Redis and start server
async function start() {
  await redis.connect();

  const subscriber = redis.duplicate();

  subscriber.on("error", (error) => {
    console.error("Redis subscriber error:", error.message);
  });

  await subscriber.connect();

  await subscriber.subscribe(CHANNEL, async () => {
    try {
      const leaderboard = await getLeaderboard();
      io.emit("leaderboard:update", leaderboard);
    } catch (error) {
      console.error("Broadcast error:", error);
    }
  });

  // Add sample players only when the leaderboard is empty
  if ((await redis.zCard(LEADERBOARD_KEY)) === 0) {
    await redis.zAdd(LEADERBOARD_KEY, [
      { score: 250, value: "Rahul" },
      { score: 180, value: "Aman" },
      { score: 120, value: "Prince" },
      { score: 90, value: "Priya" },
      { score: 75, value: "Neha" },
    ]);
  }

  server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log("Redis connected successfully");
  });
}

start().catch((error) => {
  console.error("Could not start server:", error);
  process.exit(1);
});