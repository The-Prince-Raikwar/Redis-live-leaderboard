
const socket = io();

const leaderboardElement = document.getElementById("leaderboard");
const playerCountElement = document.getElementById("playerCount");
const topPlayerElement = document.getElementById("topPlayer");
const highestScoreElement = document.getElementById("highestScore");
const connectionStatus = document.getElementById("connectionStatus");

const form = document.getElementById("scoreForm");
const submitButton = document.getElementById("submitButton");
const formMessage = document.getElementById("formMessage");

function renderLeaderboard(players) {
  leaderboardElement.replaceChildren();

  playerCountElement.textContent = players.length;
  topPlayerElement.textContent = players[0]?.name ?? "—";
  highestScoreElement.textContent = (
    players[0]?.score ?? 0
  ).toLocaleString();

  if (players.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No players yet. Add the first score!";
    leaderboardElement.appendChild(empty);
    return;
  }

  players.forEach((player) => {
    const row = document.createElement("div");
    row.className = "player-row";

    // Player identity
    const identity = document.createElement("div");
    identity.className = "player-identity";

    const rank = document.createElement("span");
    rank.className = `rank ${
      player.rank <= 3 ? `rank-${player.rank}` : ""
    }`;
    rank.textContent = `#${player.rank}`;

    const avatar = document.createElement("span");
    avatar.className = "avatar";
    avatar.textContent = player.name.charAt(0).toUpperCase();

    const name = document.createElement("span");
    name.className = "player-name";
    name.textContent = player.name;

    identity.append(rank, avatar, name);

    // Score and actions
    const actions = document.createElement("div");
    actions.className = "player-actions";

    const score = document.createElement("span");
    score.className = "player-score";
    score.textContent = `${player.score.toLocaleString()} pts`;

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "delete-player";
    deleteButton.textContent = "Delete";
    deleteButton.setAttribute(
      "aria-label",
      `Delete ${player.name}`
    );

    deleteButton.addEventListener("click", async () => {
      const confirmed = window.confirm(
        `Are you sure you want to delete ${player.name} and their score?`
      );

      if (!confirmed) return;

      deleteButton.disabled = true;
      deleteButton.textContent = "Deleting...";

      try {
        const response = await fetch(
          `/api/players/${encodeURIComponent(player.name)}`,
          { method: "DELETE" }
        );

        const result = await response.json();

        if (!response.ok) {
          throw new Error(
            result.error || "Could not delete player"
          );
        }

        formMessage.classList.remove("error");
        formMessage.textContent =
          `${result.player} was deleted successfully.`;

        // Redis Pub/Sub updates all connected browser tabs.
      } catch (error) {
        formMessage.classList.add("error");
        formMessage.textContent = error.message;

        deleteButton.disabled = false;
        deleteButton.textContent = "Delete";
      }
    });

    actions.append(score, deleteButton);
    row.append(identity, actions);
    leaderboardElement.appendChild(row);
  });
}

async function loadLeaderboard() {
  const response = await fetch("/api/leaderboard");

  if (!response.ok) {
    throw new Error("Unable to load leaderboard");
  }

  const players = await response.json();
  renderLeaderboard(players);
}

// Socket.IO connection status
socket.on("connect", () => {
  connectionStatus.textContent = "LIVE";

  loadLeaderboard().catch((error) => {
    leaderboardElement.textContent = error.message;
  });
});

socket.on("disconnect", () => {
  connectionStatus.textContent = "RECONNECTING";
});

socket.on("leaderboard:update", (players) => {
  renderLeaderboard(players);
});

// Award points
form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const name = document.getElementById("playerName").value.trim();
  const points = Number(
    document.getElementById("points").value
  );

  formMessage.classList.remove("error");
  formMessage.textContent = "";

  submitButton.disabled = true;
  submitButton.textContent = "Updating score...";

  try {
    const response = await fetch("/api/score", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name, points }),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(
        result.error || "Could not update score"
      );
    }

    formMessage.textContent =
      `${result.player} now has ${result.score.toLocaleString()} points.`;

    document.getElementById("playerName").value = "";
    document.getElementById("points").value = "10";
  } catch (error) {
    formMessage.classList.add("error");
    formMessage.textContent = error.message;
  } finally {
    submitButton.disabled = false;
    submitButton.innerHTML = 'Award points <span>↗</span>';
  }
});