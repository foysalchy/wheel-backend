const db = require("../db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

// ======================
// REGISTER
// ======================
 
exports.changePassword = (req, res) => {
  const { userId, oldPassword, newPassword } = req.body;

  if (!userId || !oldPassword || !newPassword) {
    return res.status(400).json({ message: "All fields required" });
  }

  // 1. get user
  db.query(
    "SELECT password FROM users WHERE id = ?",
    [userId],
    (err, result) => {
      if (err) return res.status(500).json(err);

      if (result.length === 0) {
        return res.status(404).json({ message: "User not found" });
      }

      const isMatch = bcrypt.compareSync(
        oldPassword,
        result[0].password
      );

      if (!isMatch) {
        return res.status(400).json({ message: "Old password incorrect" });
      }

      // 2. hash new password
      const hash = bcrypt.hashSync(newPassword, 10);

      // 3. update password
      db.query(
        "UPDATE users SET password = ?, password_txt = ? WHERE id = ?",
        [hash, newPassword, userId],
        (err2) => {
          if (err2) return res.status(500).json(err2);

          return res.json({
            success: true,
            message: "Password updated successfully"
          });
        }
      );
    }
  );
};
exports.getGameSettings = (req, res) => {
  db.query(
    `SELECT game_win_mode, win_per, win_rate, game_time_mode 
     FROM settings 
     LIMIT 1`,
    (err, result) => {
      if (err) return res.status(500).json(err);

      return res.json(result[0]);
    }
  );
};
exports.register = (req, res) => {
  const {
    name,
    username,
    email,
    phone,
    password
  } = req.body;

  const photo = req.file ? req.file.filename : null;

  // validation
  if (!username || !password) {
    return res.status(400).json({ message: "Username & password required" });
  }

  const hash = bcrypt.hashSync(password, 10);

  // check duplicate user
  db.query(
    "SELECT id FROM users WHERE username = ? OR email = ?",
    [username, email],
    (err, result) => {
      if (err) return res.status(500).json(err);

      if (result.length > 0) {
        return res.status(409).json({ message: "User already exists" });
      }

      // insert user
      db.query(
        `INSERT INTO users 
        (name, username, email, phone, password,password_txt, photo, wallet) 
        VALUES (?, ?, ?, ?, ?,?, ?, ?)`,
        [
          name || null,
          username,
          email || null,
          phone || null,
          hash,
          password,
          photo,
          1000
        ],
        (err, result) => {
          if (err) return res.status(500).json(err);

          return res.json({
            success: true,
            userId: result.insertId
          });
        }
      );
    }
  );
};
exports.deposit = (req, res) => {
  const { amount, method, accountNumber, trxId } = req.body;
  const screenshot = req.file ? req.file.filename : null;

  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.id;

    if (!amount || !method || !accountNumber || !trxId) {
      return res.status(400).json({
        message: "All fields are required",
      });
    }

    const sql = `
      INSERT INTO deposits 
      (user_id, amount, method, account_number, trx_id, screenshot)
      VALUES (?, ?, ?, ?, ?, ?)
    `;

    db.query(
      sql,
      [userId, amount, method, accountNumber, trxId, screenshot],
      (err, result) => {
        if (err) {
          if (err.code === "ER_DUP_ENTRY") {
            return res.status(400).json({
              message: "Transaction ID already exists",
            });
          }

          return res.status(500).json(err);
        }

        res.json({
          success: true,
          message: "Deposit request submitted successfully",
          depositId: result.insertId,
        });
      }
    );
  } catch (error) {
    return res.status(401).json({
      message: "Invalid token",
    });
  }
};
exports.getDepositHistory = (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    db.query(
      `SELECT * FROM deposits 
       WHERE user_id = ? 
       ORDER BY created_at DESC`,
      [decoded.id],
      (err, results) => {
        if (err) return res.status(500).json(err);

        res.json(results);
      }
    );
  } catch (error) {
    res.status(401).json({ message: "Invalid token" });
  }
};
exports.getWithdrawHistory = (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    db.query(
      `SELECT * FROM withdrawals 
       WHERE user_id = ? 
       ORDER BY created_at DESC`,
      [decoded.id],
      (err, results) => {
        if (err) return res.status(500).json(err);

        res.json(results);
      }
    );
  } catch (error) {
    res.status(401).json({ message: "Invalid token" });
  }
};
exports.withdraw = (req, res) => {
  const { method, accountNumber, accountName, amount } = req.body;

  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.id;

    if (!method || !accountNumber || !accountName || !amount) {
      return res.status(400).json({
        message: "All fields are required",
      });
    }

    if (amount <= 0) {
      return res.status(400).json({
        message: "Invalid amount",
      });
    }

    // 1. check user wallet first
    db.query(
      "SELECT wallet FROM users WHERE id = ?",
      [userId],
      (err, result) => {
        if (err) return res.status(500).json(err);

        if (result.length === 0) {
          return res.status(404).json({ message: "User not found" });
        }

        const wallet = result[0].wallet;

        if (wallet < amount) {
          return res.status(400).json({
            message: "Insufficient balance",
          });
        }

        // 2. insert withdraw request
        const sql = `
          INSERT INTO withdrawals 
          (user_id, amount, method, account_number, account_name, status)
          VALUES (?, ?, ?, ?, ?, 'pending')
        `;

        db.query(
          sql,
          [userId, amount, method, accountNumber, accountName],
          (err2, result2) => {
            if (err2) return res.status(500).json(err2);

            // 3. (optional) deduct wallet immediately or later after approval
            db.query(
              "UPDATE users SET wallet = wallet - ? WHERE id = ?",
              [amount, userId]
            );

            return res.json({
              success: true,
              message: "Withdraw request submitted successfully",
              withdrawId: result2.insertId,
            });
          }
        );
      }
    );
  } catch (error) {
    return res.status(401).json({
      message: "Invalid token",
    });
  }
};
exports.getDashboardSummary = (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.id;
    console.log(userId)
    // TOTAL DEPOSIT
    const depositQuery = `
      SELECT IFNULL(SUM(amount), 0) as totalDeposit
      FROM deposits
      WHERE user_id = ?
    `;

    // TOTAL WITHDRAW
    const withdrawQuery = `
      SELECT IFNULL(SUM(amount), 0) as totalWithdraw
      FROM withdrawals
      WHERE user_id = ?
    `;

    db.query(depositQuery, [userId], (err, depResult) => {
      if (err) return res.status(500).json(err);

      db.query(withdrawQuery, [userId], (err2, witResult) => {
        if (err2) return res.status(500).json(err2);

        res.json({
          totalDeposit: depResult[0].totalDeposit,
          totalWithdraw: witResult[0].totalWithdraw,
        });
      });
    });
  } catch (error) {
    return res.status(401).json({ message: "Invalid token" });
  }
};
// ======================
// LOGIN
// ======================
exports.login = (req, res) => {
  const { username, password } = req.body;

  db.query(
    "SELECT * FROM users WHERE username=?",
    [username],
    (err, result) => {
      if (err) return res.status(500).json(err);

      if (result.length === 0)
        return res.status(400).json({ message: "User not found" });

      const user = result[0];

      const match = bcrypt.compareSync(password, user.password);

      if (!match)
        return res.status(400).json({ message: "Wrong password" });

      const token = jwt.sign(
        { id: user.id, username: user.username },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
      );

      res.json({
        success: true,
        token,
        user: {
          id: user.id,
          username: user.username,
          wallet: user.wallet,
        },
      });
    }
  );
};
exports.getBetHistory = (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.id;

    const { page = 1, limit = 20, from, to, status } = req.query;

    const offset = (page - 1) * limit;

    let sql = `
      SELECT id, user_id, round_id, number, amount, status, is_paid, created_at
      FROM bets
      WHERE user_id = ?
    `;

    const params = [userId];

    // DATE FILTER
    if (from && to) {
      sql += ` AND DATE(created_at) BETWEEN ? AND ? `;
      params.push(from, to);
    }

    // STATUS FILTER
    if (status && status !== "all") {
      sql += ` AND status = ? `;
      params.push(status);
    }

    sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ? `;

    params.push(parseInt(limit), parseInt(offset));

    db.query(sql, params, (err, results) => {
      if (err) return res.status(500).json(err);

      // total count query
      let countSql = `
        SELECT COUNT(*) as total 
        FROM bets 
        WHERE user_id = ?
      `;

      const countParams = [userId];

      if (from && to) {
        countSql += ` AND DATE(created_at) BETWEEN ? AND ? `;
        countParams.push(from, to);
      }

      if (status && status !== "all") {
        countSql += ` AND status = ? `;
        countParams.push(status);
      }

      db.query(countSql, countParams, (err2, countResult) => {
        if (err2) return res.status(500).json(err2);

        const total = countResult[0].total;

        res.json({
          success: true,
          data: results,
          pagination: {
            total,
            page: parseInt(page),
            limit: parseInt(limit),
            totalPages: Math.ceil(total / limit),
          },
        });
      });
    });

  } catch (error) {
    return res.status(401).json({ message: "Invalid token" });
  }
};
exports.getRoundHistory = (req, res) => {
  const {
    type = "1min",
    page = 1,
    limit = 20,
    fromDate = null,
    toDate = null,
  } = req.query;

  const offset = (page - 1) * limit;

  db.query(
    `SELECT * FROM rounds WHERE status = 1 ORDER BY created_at DESC`,
    (err, results) => {
      if (err) return res.status(500).json(err);

      let filtered = [];

      for (let i = 0; i < results.length; i++) {
        const current = results[i];
        const prev = results[i + 1];

        if (!prev) continue;

        const currentTime = new Date(current.created_at).getTime();
        const prevTime = new Date(prev.created_at).getTime();

        const diffMinutes = Math.abs(currentTime - prevTime) / 60000;

        if (type === "1min" && diffMinutes <= 2) {
          filtered.push(current);
        }

        if (type === "15min" && diffMinutes >= 14) {
          filtered.push(current);
        }
      }

      // =========================
      // FROM - TO DATE FILTER
      // =========================
      if (fromDate && toDate) {
        const from = new Date(fromDate).getTime();
        const to = new Date(toDate).getTime();

        filtered = filtered.filter((r) => {
          const time = new Date(r.created_at).getTime();
          return time >= from && time <= to;
        });
      }

      const paginated = filtered.slice(offset, offset + Number(limit));

      const grouped = {};

      paginated.forEach((round) => {
        const d = new Date(round.created_at).toISOString().split("T")[0];

        if (!grouped[d]) grouped[d] = [];
        grouped[d].push(round);
      });

      return res.json({
        success: true,
        data: Object.values(grouped),
        page: Number(page),
        totalPages: Math.ceil(filtered.length / limit),
      });
    }
  );
};
exports.getVipHistoryByDate = (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) return res.status(401).json({ message: "Unauthorized" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.id;

    const { from, to } = req.query;

    let sql = `
      SELECT id, user_id, amount, is_paid, created_at
      FROM bets
      WHERE user_id = ?
    `;

    const params = [userId];

    if (from && to) {
      sql += ` AND DATE(created_at) BETWEEN ? AND ? `;
      params.push(from, to);
    }

    sql += ` ORDER BY created_at DESC`;

    db.query(sql, params, (err, results) => {
      if (err) return res.status(500).json(err);
      res.json(results);
    });

  } catch (e) {
    return res.status(401).json({ message: "Invalid token" });
  }
};
