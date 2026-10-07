const Vehicle = require("../models/Vehicle");
const Trip = require("../models/Trip");
const ApiError = require("../utils/ApiError");
const { requireObjectId, pagination } = require("../utils/validate");

const EDITABLE = ["plateNumber", "make", "vehicleModel", "type", "isActive"];

async function findVehicle(req) {
  const id = requireObjectId(req.params.id, "vehicle id");
  const vehicle = await Vehicle.findOne({ _id: id, manager: req.user.id });
  if (!vehicle) throw new ApiError(404, "Vehicle not found");
  return vehicle;
}

async function createVehicle(req, res) {
  const { plateNumber, make, vehicleModel, type } = req.body || {};
  const vehicle = await Vehicle.create({
    manager: req.user.id,
    plateNumber,
    make,
    vehicleModel,
    type,
  });
  res.status(201).json({ data: vehicle });
}

async function listVehicles(req, res) {
  const { page, limit, skip } = pagination(req.query);
  const filter = { manager: req.user.id };
  if (req.query.active !== undefined) filter.isActive = req.query.active === "true";

  const [vehicles, total] = await Promise.all([
    Vehicle.find(filter).sort({ plateNumber: 1 }).skip(skip).limit(limit),
    Vehicle.countDocuments(filter),
  ]);
  res.json({ data: vehicles, meta: { page, limit, total } });
}

async function getVehicle(req, res) {
  res.json({ data: await findVehicle(req) });
}

async function updateVehicle(req, res) {
  const vehicle = await findVehicle(req);
  const body = req.body || {};
  for (const field of EDITABLE) {
    if (body[field] !== undefined) vehicle[field] = body[field];
  }
  await vehicle.save();
  res.json({ data: vehicle });
}

// Vehicles are deactivated rather than deleted so past trips keep their vehicle
async function deactivateVehicle(req, res) {
  const vehicle = await findVehicle(req);
  const busy = await Trip.exists({ vehicle: vehicle._id, status: "in_progress" });
  if (busy) throw new ApiError(409, "Vehicle has a trip in progress");
  vehicle.isActive = false;
  await vehicle.save();
  res.json({ data: vehicle });
}

module.exports = { createVehicle, listVehicles, getVehicle, updateVehicle, deactivateVehicle };
