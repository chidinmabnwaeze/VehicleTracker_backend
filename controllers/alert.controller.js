const Alert = require("../models/Alert");
const ApiError = require("../utils/ApiError");
const { requireObjectId, pagination } = require("../utils/validate");

async function listAlerts(req, res) {
  const { page, limit, skip } = pagination(req.query);
  const filter = { manager: req.user.id };

  if (req.query.tripId) filter.trip = requireObjectId(req.query.tripId, "tripId");
  if (req.query.type) {
    const types = String(req.query.type).split(",");
    const unknown = types.find((type) => !Alert.ALERT_TYPES.includes(type));
    if (unknown) throw new ApiError(400, `Unknown alert type: ${unknown}`);
    filter.type = { $in: types };
  }
  if (req.query.unread === "true") filter.readAt = null;

  const [alerts, total, unread] = await Promise.all([
    Alert.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Alert.countDocuments(filter),
    Alert.countDocuments({ manager: req.user.id, readAt: null }),
  ]);
  res.json({ data: alerts, meta: { page, limit, total, unread } });
}

async function markRead(req, res) {
  const id = requireObjectId(req.params.id, "alert id");
  const alert = await Alert.findOne({ _id: id, manager: req.user.id });
  if (!alert) throw new ApiError(404, "Alert not found");
  if (!alert.readAt) {
    alert.readAt = new Date();
    await alert.save();
  }
  res.json({ data: alert });
}

async function markAllRead(req, res) {
  const filter = { manager: req.user.id, readAt: null };
  if (req.query.tripId) filter.trip = requireObjectId(req.query.tripId, "tripId");
  const result = await Alert.updateMany(filter, { $set: { readAt: new Date() } });
  res.json({ data: { updated: result.modifiedCount } });
}

module.exports = { listAlerts, markRead, markAllRead };
