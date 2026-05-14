const express = require("express");
const router = express.Router();
const upload = require("../middleware/upload"); // <-- Add this line

const auth = require("../controllers/authController");

router.post("/register", upload.single("photo"), auth.register);
router.post("/login", auth.login);
router.post("/change-password", auth.changePassword);
router.post(
  "/deposit",
  upload.single("screenshot"),
  auth.deposit
);
router.post("/withdraw",auth.withdraw);
router.get("/deposit-history", auth.getDepositHistory);
router.get("/vip-history", auth.getVipHistoryByDate);
router.get("/dashboard-summary", auth.getDashboardSummary);
router.get("/withdraw-history", auth.getWithdrawHistory);
module.exports = router;