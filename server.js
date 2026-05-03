const express = require("express");
require("dotenv").config();
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");
const db = require("./db");
const app = express();
app.use(cors());

// Middleware
app.use(cors());
app.use(express.json()); // Parse JSON request bodies
app.use(express.urlencoded({ extended: true })); // Optional, for form data

// Routes
const authRoutes = require("./routes/authRoutes");
app.use("/api/auth", authRoutes);
app.use("/uploads", express.static("uploads"));
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*" },
});

// ======================
// CONFIG
// ======================
const ROUND_TIME = 60;
const BET_TIME = 50; // last 10 sec locked

let roundId = null;
let timeLeft = ROUND_TIME;
let bettingOpen = true;

let result = null;
let resultHoldTime = 0;

let roundTimer = null;
let resultTimer = null;

// ======================
// GLOBAL STATE
// ======================
let gameState = {
  roundId: null,
  timeLeft: ROUND_TIME,
  bettingOpen: true,
  result: null,
  resultHoldTime: 0,
  phase: "betting", // betting | locked | result
};

// ======================
// SYNC
// ======================
function sync() {
  io.emit("sync_state", gameState);
}

// ======================
// START ROUND
// ======================
function startRound() {
  clearInterval(roundTimer);
  clearInterval(resultTimer);

  roundId = Date.now().toString();
  timeLeft = ROUND_TIME;
  bettingOpen = true;

  gameState = {
    roundId,
    timeLeft,
    bettingOpen: true,
    result: null,
    resultHoldTime: 0,
    phase: "betting",
  };

  io.emit("round_start", { roundId });
  sync();

  roundTimer = setInterval(() => {
    timeLeft--;

    gameState.timeLeft = timeLeft;

    // 🔥 last 10 sec lock
    if (timeLeft <= 10) {
      bettingOpen = false;
      gameState.bettingOpen = false;
      gameState.phase = "locked";
      io.emit("spinning");
    }

    io.emit("timer", { timeLeft });
    sync();

    if (timeLeft <= 0) {
      clearInterval(roundTimer);
      spin();
    }
  }, 1000);
}

// ======================
// SPIN
// ======================
function spin() {
  const finalResult = Math.floor(Math.random() * 9) + 1;

  result = finalResult;
  gameState.result = finalResult;
  gameState.phase = "result";

  io.emit("result", { result: finalResult });

  // ======================
  // GET ALL BETS OF ROUND
  // ======================
  db.query(
    "SELECT * FROM bets WHERE round_id=?",
    [roundId],
    (err, bets) => {
      if (err) return;

      bets.forEach((bet) => {
        const isWin = bet.number === finalResult;

        if (isWin) {
          const winAmount = bet.amount * 3;

          // ======================
          // WIN CASE
          // ======================
          db.query(
            "UPDATE users SET wallet = wallet + ? WHERE id=?",
            [winAmount, bet.user_id]
          );

          db.query(
            "UPDATE bets SET status=1 WHERE id=?",
            [bet.id]
          );

          // wallet update emit
          db.query(
            "SELECT wallet FROM users WHERE id=?",
            [bet.user_id],
            (err2, res) => {
              if (!err2 && res.length) {
                io.emit("wallet_update", {
                  userId: bet.user_id,
                  wallet: res[0].wallet,
                });
              }
            }
          );
        } else {
          // ======================
          // LOSS CASE
          // ======================
          db.query(
            "UPDATE bets SET status=2 WHERE id=?",
            [bet.id]
          );
        }
      });
    }
  );

  // ======================
  // RESULT TIMER
  // ======================
  resultHoldTime = 30;
  gameState.resultHoldTime = 30;

  resultTimer = setInterval(() => {
    resultHoldTime--;
    gameState.resultHoldTime = resultHoldTime;

    io.emit("result_timer", {
      timeLeft: resultHoldTime,
      result: finalResult,
    });

    sync();

    if (resultHoldTime <= 0) {
      clearInterval(resultTimer);
      startRound();
    }
  }, 1000);
}

// ======================
// SOCKET
// ======================
io.on("connection", (socket) => {
  console.log("User connected");

  socket.emit("sync_state", gameState);

  // ======================
  // GET USER (wallet load)
  // ======================
  
  socket.on("get_user", (data) => {
    const jwt = require("jsonwebtoken");
console.log(data,'data')
    
      const user = jwt.verify(data.token, process.env.JWT_SECRET);
console.log(user,'data')
console.log("JWT:", process.env.JWT_SECRET);
      db.query(
        "SELECT wallet FROM users WHERE id=?",
        [user.id],
        (err, res) => {
          if (!err && res.length > 0) {
            socket.emit("user_data", {
              wallet: res[0].wallet,
              userId: user.id,
            });
          }
        }
      );
    // } catch (e) {
    //   socket.emit("user_data", { wallet: 0 });
    // }
  });

  // ======================
  // PLACE BET
  // ======================
  socket.on("place_bet", (data) => {
    if (!gameState.bettingOpen) return;

    const { token, number, amount } = data;

    try {
      const jwt = require("jsonwebtoken");
      const user = jwt.verify(token, process.env.JWT_SECRET);

      const userId = user.id;

      db.query(
        "SELECT wallet FROM users WHERE id=?",
        [userId],
        (err, res) => {
          if (err || !res.length) return;

          const wallet = res[0].wallet;

          if (wallet < amount) {
            socket.emit("bet_error", { message: "Low balance" });
            return;
          }

          // deduct
          db.query(
            "UPDATE users SET wallet = wallet - ? WHERE id=?",
            [amount, userId]
          );

          // insert bet
          db.query(
            "INSERT INTO bets (user_id, number, amount, round_id) VALUES (?, ?, ?, ?)",
            [userId, number, amount, roundId]
          );

          // bet count
          db.query(
            "SELECT COUNT(*) as total FROM bets WHERE round_id=?",
            [roundId],
            (err, r) => {
              if (!err) io.emit("bet_count", { total: r[0].total });
            }
          );

          // wallet update realtime
          db.query(
            "SELECT wallet FROM users WHERE id=?",
            [userId],
            (err, r2) => {
              if (!err && r2.length) {
                socket.emit("user_data", {
                  wallet: r2[0].wallet,
                });
              }
            }
          );
        }
      );
    } catch (e) {
      socket.emit("bet_error", { message: "Invalid token" });
    }
  });

  socket.on("get_bet_history", (data) => {
  const jwt = require("jsonwebtoken");

  try {
    const user = jwt.verify(data.token, process.env.JWT_SECRET);
    const userId = user.id;

    db.query(
      "SELECT id, amount, created_at, status FROM bets WHERE user_id=? ORDER BY id DESC",
      [userId],
      (err, result) => {
        if (err) {
          socket.emit("bet_history", []);
          return;
        }

        const formatted = result.map((bet) => ({
          id: bet.round_id,
          amount: bet.amount,
          createdAt: bet.created_at,
          status: bet.status === 1 ? "win" : "loss",
        }));

        socket.emit("bet_history", formatted);
      }
    );
  } catch (e) {
    socket.emit("bet_history", []);
  }
});
});
// ======================
server.listen(5000, () => {
  console.log("Server running");
  startRound();
});