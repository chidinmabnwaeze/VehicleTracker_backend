const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const { authenticate, authorize } = require("../middleware/auth");
const auth = require("../controllers/auth.controller");
const drivers = require("../controllers/driver.controller");
const vehicles = require("../controllers/vehicle.controller");
const trips = require("../controllers/trip.controller");
const alerts = require("../controllers/alert.controller");

const router = Router();
const manager = authorize("manager");
const driver = authorize("driver");

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many attempts, please try again later" },
});

router.post("/auth/register", authLimiter, auth.register);
router.post("/auth/login", authLimiter, auth.login);

router.use(authenticate);

router.get("/auth/me", auth.me);
router.post("/auth/fcm-token", auth.addFcmToken);
router.delete("/auth/fcm-token", auth.removeFcmToken);

router.post("/drivers", manager, drivers.createDriver);
router.get("/drivers", manager, drivers.listDrivers);
router.get("/drivers/:id", manager, drivers.getDriver);
router.patch("/drivers/:id", manager, drivers.updateDriver);
router.delete("/drivers/:id", manager, drivers.deactivateDriver);

router.post("/vehicles", manager, vehicles.createVehicle);
router.get("/vehicles", manager, vehicles.listVehicles);
router.get("/vehicles/:id", manager, vehicles.getVehicle);
router.patch("/vehicles/:id", manager, vehicles.updateVehicle);
router.delete("/vehicles/:id", manager, vehicles.deactivateVehicle);

router.post("/trips", manager, trips.createTrip);
router.get("/trips", trips.listTrips);
router.get("/trips/:id", trips.getTrip);
router.get("/trips/:id/locations", trips.listLocations);
router.post("/trips/:id/start", driver, trips.startTrip);
router.post("/trips/:id/location", driver, trips.postLocation);
router.post("/trips/:id/complete", trips.completeTrip);
router.post("/trips/:id/cancel", manager, trips.cancelTrip);

router.get("/alerts", manager, alerts.listAlerts);
router.patch("/alerts/read-all", manager, alerts.markAllRead);
router.patch("/alerts/:id/read", manager, alerts.markRead);

module.exports = router;
