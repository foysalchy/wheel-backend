 
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
app.get("/", (req, res) => {
  res.status(200).send("API is running successfully ╨Б╨п╨к╨Р");
});
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
// function startRound() {
//   clearInterval(roundTimer);
//   clearInterval(resultTimer);

//   // ЁЯФе DB CHECK: already running round ржЖржЫрзЗ ржХрж┐ржирж╛
//   db.query(
//     "SELECT id FROM rounds WHERE status = 0 ORDER BY id DESC LIMIT 1",
//     (err, res) => {
//       if (err) return;

//       // тЭМ ржпржжрж┐ active round ржерж╛ржХрзЗ тЖТ ржирждрзБржи start рж╣ржмрзЗ ржирж╛
//     //   if (res.length > 0) {
//     //     console.log("Round already running, skipping new round");
//     //     return;
//     //   }

//       // тЬЕ safe to start new round
//       roundId = Date.now().toString();
//       timeLeft = ROUND_TIME;
//       bettingOpen = true;

//       db.query(
//         "INSERT INTO rounds (roundid, status) VALUES (?, 0)",
//         [roundId]
//       );

//       gameState = {
//         roundId,
//         timeLeft,
//         bettingOpen: true,
//         result: null,
//         resultHoldTime: 0,
//         phase: "betting",
//       };

//       io.emit("round_start", { roundId });
//       sync();

//       roundTimer = setInterval(() => {
//         timeLeft--;
//         gameState.timeLeft = timeLeft;

//         if (timeLeft <= 10) {
//           bettingOpen = false;
//           gameState.bettingOpen = false;
//           gameState.phase = "locked";
//           io.emit("spinning");
//         }

//         io.emit("timer", { timeLeft });
//         sync();

//         if (timeLeft <= 0) {
//           clearInterval(roundTimer);
//           spin();
//         }
//       }, 1000);
//     }
//   );
// }
function sendBetSummary(roundId) {
  console.log('hitting')
  db.query(
    `
    SELECT number, SUM(amount) as total
    FROM bets
    WHERE round_id = ?
    GROUP BY number
    `,
    [roundId],
    (err, res) => {
  console.log('hitting2')

      if (err) return console.log(err);
  console.log('hittin3')

      io.emit("bet_summary", res);
    }
  );
}

function startRound() {
  clearInterval(roundTimer);
  clearInterval(resultTimer);

  roundId = Date.now().toString();
  timeLeft = ROUND_TIME;
  bettingOpen = true;
  db.query(
    "INSERT INTO rounds (roundid, status) VALUES (?, 0)",
    [roundId]
  );
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

    // ЁЯФе last 10 sec lock
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
async  function spin() {
    
  let finalResult;
    const [[roundData]] = await db.promise().query(
      "SELECT result FROM rounds WHERE roundid = ? LIMIT 1",
      [roundId]
    );

   const [[setting]] = await db.promise().query(
      "SELECT game_win_mode, win_per, win_rate FROM settings LIMIT 1"
    );
    const WIN_RATE = Number(setting.win_rate || 1);
    if (roundData?.result !== null && roundData?.result !== undefined) {
      finalResult = roundData.result;
    } else {
        

      const [[promoCheck]] = await db.promise().query(`
      SELECT 
        SUM(CASE WHEN u.is_promoter = 0 THEN 1 ELSE 0 END) as nonPromoCount
      FROM bets b
      JOIN users u ON b.user_id = u.id
      WHERE b.round_id = ?
    `, [roundId]);

    const isAllPromote = (promoCheck?.nonPromoCount || 0) === 0;

      if (isAllPromote) {
        // 👇 all users are promote = 1 → pick random winner from bet numbers
          const [allBets] = await db.promise().query(`
          SELECT DISTINCT b.number
          FROM bets b
          JOIN users u ON b.user_id = u.id
          WHERE b.round_id = ?
        `, [roundId]);

        if (allBets.length > 0) {
          const randomIndex = Math.floor(Math.random() * allBets.length);
          finalResult = allBets[randomIndex].number;
        } else {
          finalResult = Math.floor(Math.random() * 9) + 1;
        }


      } else {

        const [[totalRow]] = await db.promise().query(
          "SELECT SUM(amount) as total FROM bets WHERE round_id=?",
          [roundId]
        );
        const gameMode = setting.game_win_mode;
        const WIN_PER = setting.win_per;
        const totalBet = totalRow?.total || 0;
       const [group] = await db.promise().query(`
          SELECT number, SUM(amount) as total
          FROM bets
          WHERE round_id = ?
          GROUP BY number
        `, [roundId]);

        // CREATE DEFAULT 0-9 MAP
        const betsMap = {};

        for (let i = 0; i <= 9; i++) {
          betsMap[i] = 0;
        }

        // REPLACE WITH REAL BETS
        group.forEach(g => {
          betsMap[g.number] = Number(g.total || 0);
        });
        if (gameMode == 1) {
           let lowestNumbers = [];
            let lowestAmount = Infinity;

            for (let i = 0; i <= 9; i++) {

              const total = betsMap[i];

              if (total < lowestAmount) {
                lowestAmount = total;
                lowestNumbers = [i];
              } else if (total === lowestAmount) {
                lowestNumbers.push(i);
              }
            }

            finalResult =
              lowestNumbers[
                Math.floor(Math.random() * lowestNumbers.length)
              ];
        }else if (gameMode == 2) {
          const targetProfit = totalBet * (WIN_PER / 100);

          const maxPayout = totalBet - targetProfit;

          let possible = [];

          for (let i = 0; i <= 9; i++) {

            const total = betsMap[i];

            const payout = total * WIN_RATE;

            if (payout <= maxPayout) {
              possible.push(i);
            }
          }

          finalResult =
            possible.length > 0
              ? possible[Math.floor(Math.random() * possible.length)]
              : Math.floor(Math.random() * 10);
        }
      }
    }
 

 

  let userWins = {};
  let done = 0;

  result = finalResult;
  gameState.result = finalResult;
  gameState.phase = "result";

  // ======================
  // UPDATE ROUND FIRST
  // ======================
  db.query(
    "UPDATE rounds SET result=?, status=1, ended_at=NOW() WHERE roundid=?",
    [finalResult, roundId]
  );

  // ======================
  // GET BETS
  // ======================
  db.query(
    "SELECT * FROM bets WHERE round_id=? AND status=0",
    [roundId],
    (err, bets) => {
      if (err) return;

      // ╤А╨╢╨┐╤А╨╢╨╢╤А╨╢тФР ╤А╨╢╨е╤А╨╖╨Ы╤А╨╢╨╕╤А╨╖╨Ы bet ╤А╨╢╨╕╤А╨╢тХЫ ╤А╨╢╨╡╤А╨╢тХЫ╤А╨╢╨е╤А╨╖╨Ч
      if (!bets.length) {
        return finishResult();
      }

      bets.forEach((bet) => {
        const isWin = bet.number === finalResult;

        if (isWin) {
          const winAmount = bet.amount * WIN_RATE;

          // wallet update
          db.query(
            "UPDATE users SET wallet = wallet + ? WHERE id=?",
            [winAmount, bet.user_id]
          );

          // store user win
          if (!userWins[bet.user_id]) {
            userWins[bet.user_id] = 0;
          }
          userWins[bet.user_id] += winAmount;

          // mark win bet
          db.query(
            "UPDATE bets SET status=1 WHERE id=?",
            [bet.id]
          );

          // realtime wallet update
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
          // loss
          db.query(
            "UPDATE bets SET status=2 WHERE id=?",
            [bet.id]
          );
        }

        // completion tracking
        done++;

        if (done === bets.length) {
          finishResult();
        }
      });

      // ======================
      // FINAL FUNCTION (SAFE EMIT)
      // ======================
      function finishResult() {
        // last results update
        db.query(
          "SELECT result FROM rounds WHERE status=1 ORDER BY id DESC LIMIT 10",
          (err, res) => {
            if (!err) {
              const results = res.map((r) => r.result);
              io.emit("last_results", results);
            }
          }
        );

        // ╤В╨м╨Х NOW SAFE EMIT (important)
        io.emit("result", {
          result: finalResult,
          userWins,
        });

        // ======================
        // RESULT TIMER
        // ======================
        resultHoldTime = 8;
        gameState.resultHoldTime = 8;

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
    }
  );
}

// ======================
// SOCKET
// ======================
io.on("connection", (socket) => {
  console.log("User connected");

  socket.emit("sync_state", gameState);


  socket.on("get_last_results", (data) => {
    db.query(
      "SELECT result FROM rounds WHERE status=1 ORDER BY id DESC LIMIT 10",
      (err, res) => {
        if (err) return;

        const results = res.map(r => r.result);

        socket.emit("last_results", results);
      }
    );
  });
  // ======================
  // GET USER (wallet load)
  // ======================
  socket.on("cancel_bet", (data) => {
    const jwt = require("jsonwebtoken");

    try {
      const user = jwt.verify(data.token, process.env.JWT_SECRET);
      const userId = user.id;

      // current round bets only
      db.query(
        "SELECT * FROM bets WHERE user_id=? AND round_id=? AND status=0",
        [userId, roundId],
        (err, bets) => {
          if (err || !bets.length) return;

          let totalRefund = 0;

          bets.forEach((b) => {
            totalRefund += b.amount;
          });

          // refund wallet
          db.query(
            "UPDATE users SET wallet = wallet + ? WHERE id=?",
            [totalRefund, userId]
          );

          // mark cancelled
          db.query(
            "UPDATE bets SET status=3 WHERE user_id=? AND round_id=?",
            [userId, roundId]
          );

          // send updated wallet
          db.query(
            "SELECT wallet FROM users WHERE id=?",
            [userId],
            (err2, res) => {
              if (!err2 && res.length) {
                socket.emit("user_data", {
                  wallet: res[0].wallet,
                });
              }
            }
          );

          socket.emit("cancel_success", { refunded: totalRefund });
        }
      );
    } catch (e) {
      socket.emit("bet_error", { message: "Invalid token" });
    }
  });
  
  socket.on("get_user", (data) => {
    const jwt = require("jsonwebtoken");
 
    
      const user = jwt.verify(data.token, process.env.JWT_SECRET);
 
      db.query(
        "SELECT * FROM users WHERE id=?",
        [user.id],
        (err, res) => {
          if (!err && res.length > 0) {
            socket.emit("user_data", {
              wallet: res[0].wallet,
              userId: user.id,
              data: res[0],
            });
          }
        }
      );
    // } catch (e) {
    //   socket.emit("user_data", { wallet: 0 });
    // }
  });
  socket.on("get_current_bets", (data) => {
  const jwt = require("jsonwebtoken");

  try {
    const user = jwt.verify(data.token, process.env.JWT_SECRET);
    const userId = user.id;

    db.query(
      "SELECT number, amount FROM bets WHERE user_id=? AND round_id=? AND status=0",
      [userId, roundId],
      (err, bets) => {
        if (err) return;

        socket.emit("current_bets", bets);
      }
    );
  } catch (e) {
    socket.emit("current_bets", []);
  }
});
socket.on("repeat_bet", (data) => {
  const jwt = require("jsonwebtoken");

  try {
    const user = jwt.verify(data.token, process.env.JWT_SECRET);
    const userId = user.id;

    // 1. আগে last bets বের করো
    db.query(
      `SELECT number, amount 
       FROM bets 
       WHERE user_id = ? 
       AND round_id = (
         SELECT round_id 
         FROM bets  
         WHERE user_id = ? 
         ORDER BY id DESC 
         LIMIT 1
       )`,
      [userId, userId],
      (err, bets) => {
        if (err || !bets.length) return;

        const totalBet = bets.reduce((s, x) => s + x.amount, 0);

        // 2. আগে wallet check
        db.query(
          "SELECT wallet FROM users WHERE id = ?",
          [userId],
          (err, res) => {
            if (err || !res.length) return;

            const wallet = res[0].wallet;

            if (wallet < totalBet) {
              socket.emit("bet_error", {
                message: "Insufficient balance",
                wallet,
              });
              return;
            }

            // 3. wallet ok হলে bet insert করো
            let done = 0;

            bets.forEach((b) => {
              db.query(
                "INSERT INTO bets (user_id, number, amount, round_id) VALUES (?, ?, ?, ?)",
                [userId, b.number, b.amount, roundId],
                () => {
                  done++;

                  if (done === bets.length) {
                    // 4. wallet update
                    db.query(
                      "UPDATE users SET wallet = wallet - ? WHERE id = ?",
                      [totalBet, userId],
                      () => {
                        db.query(
                          "SELECT wallet FROM users WHERE id = ?",
                          [userId],
                          (e2, r2) => {
                            if (!e2 && r2.length) {
                              socket.emit("user_data", {
                                wallet: r2[0].wallet,
                              });
                            }
                          }
                        );

                        socket.emit("repeat_done", bets);
                      }
                    );
                  }
                }
              );
            });
          }
        );
      }
    );
  } catch (e) {
    console.log("repeat error", e.message);
  }
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
            [userId, number, amount, roundId],
            (err) => {
              if (err) return;

              // IMPORTANT: wait 50–100ms for DB consistency
              setTimeout(() => {
                sendBetSummary(roundId);
              }, 50);
            }
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
socket.on("get_bet_summary", (data) => {
  sendBetSummary(data.roundId);
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

// cancel bet

server.listen(5000, () => {
  console.log("Server running");
  startRound();
});