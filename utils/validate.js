const mongoose = require("mongoose");
const ApiError = require("./ApiError");

function requireObjectId(value, label) {
  if (!value || !mongoose.isValidObjectId(value)) {
    throw new ApiError(400, `${label} must be a valid id`);
  }
  return String(value);
}

function requireString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError(400, `${label} is required`);
  }
  return value.trim();
}

// Reads { lat, lng } and returns GeoJSON order [lng, lat]
function parseLatLng(input, label) {
  const lat = input && input.lat != null && input.lat !== "" ? Number(input.lat) : NaN;
  const lng = input && input.lng != null && input.lng !== "" ? Number(input.lng) : NaN;
  if (!(lat >= -90 && lat <= 90) || !(lng >= -180 && lng <= 180)) {
    throw new ApiError(400, `${label} needs a valid lat (-90 to 90) and lng (-180 to 180)`);
  }
  return [lng, lat];
}

function optionalNumber(value) {
  if (value == null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function pagination(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  return { page, limit, skip: (page - 1) * limit };
}

module.exports = {
  requireObjectId,
  requireString,
  parseLatLng,
  optionalNumber,
  pagination,
};
