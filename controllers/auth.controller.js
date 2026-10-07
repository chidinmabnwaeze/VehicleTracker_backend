const User = require("../models/User");
const ApiError = require("../utils/ApiError");
const { requireString } = require("../utils/validate");
const { signToken } = require("../middleware/auth");

// Public sign up creates a manager. Drivers are created by their manager.
async function register(req, res) {
  const { name, email, password, phone } = req.body || {};
  const user = await User.create({ name, email, password, phone, role: "manager" });
  res.status(201).json({ data: { user, token: signToken(user) } });
}

async function login(req, res) {
  const email = requireString(req.body && req.body.email, "email").toLowerCase();
  const password = requireString(req.body && req.body.password, "password");

  const user = await User.findOne({ email }).select("+password");
  if (!user || !(await user.comparePassword(password))) {
    throw new ApiError(401, "Incorrect email or password");
  }
  if (!user.isActive) throw new ApiError(403, "This account has been disabled");

  res.json({ data: { user, token: signToken(user) } });
}

async function me(req, res) {
  res.json({ data: req.user });
}

// Registers a device for push notifications
async function addFcmToken(req, res) {
  const token = requireString(req.body && req.body.token, "token");
  await User.updateOne({ _id: req.user.id }, { $addToSet: { fcmTokens: token } });
  res.status(204).end();
}

async function removeFcmToken(req, res) {
  const token = requireString(req.body && req.body.token, "token");
  await User.updateOne({ _id: req.user.id }, { $pull: { fcmTokens: token } });
  res.status(204).end();
}

module.exports = { register, login, me, addFcmToken, removeFcmToken };
