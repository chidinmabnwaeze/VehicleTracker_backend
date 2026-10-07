const User = require("../models/User");
const Trip = require("../models/Trip");
const ApiError = require("../utils/ApiError");
const { requireObjectId, pagination } = require("../utils/validate");

async function findDriver(req) {
  const id = requireObjectId(req.params.id, "driver id");
  const driver = await User.findOne({ _id: id, role: "driver", manager: req.user.id });
  if (!driver) throw new ApiError(404, "Driver not found");
  return driver;
}

async function createDriver(req, res) {
  const { name, email, password, phone } = req.body || {};
  const driver = await User.create({
    name,
    email,
    password,
    phone,
    role: "driver",
    manager: req.user.id,
  });
  res.status(201).json({ data: driver });
}

async function listDrivers(req, res) {
  const { page, limit, skip } = pagination(req.query);
  const filter = { role: "driver", manager: req.user.id };
  if (req.query.active !== undefined) filter.isActive = req.query.active === "true";

  const [drivers, total] = await Promise.all([
    User.find(filter).sort({ name: 1 }).skip(skip).limit(limit),
    User.countDocuments(filter),
  ]);
  res.json({ data: drivers, meta: { page, limit, total } });
}

async function getDriver(req, res) {
  res.json({ data: await findDriver(req) });
}

async function updateDriver(req, res) {
  const driver = await findDriver(req);
  const body = req.body || {};
  for (const field of ["name", "phone", "password", "isActive"]) {
    if (body[field] !== undefined) driver[field] = body[field];
  }
  await driver.save();
  res.json({ data: driver });
}

// Drivers are deactivated rather than deleted so past trips keep their driver
async function deactivateDriver(req, res) {
  const driver = await findDriver(req);
  const busy = await Trip.exists({ driver: driver._id, status: "in_progress" });
  if (busy) throw new ApiError(409, "Driver has a trip in progress");
  driver.isActive = false;
  await driver.save();
  res.json({ data: driver });
}

module.exports = { createDriver, listDrivers, getDriver, updateDriver, deactivateDriver };
