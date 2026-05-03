const db = require("../db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

// ======================
// REGISTER
// ======================
exports.register = (req, res) => {
  const { username, password } = req.body;

  const hash = bcrypt.hashSync(password, 10);

  db.query(
    "INSERT INTO users (username, password, wallet) VALUES (?, ?, ?)",
    [username, hash, 1000],
    (err) => {
      if (err) return res.status(500).json(err);

      res.json({ success: true });
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