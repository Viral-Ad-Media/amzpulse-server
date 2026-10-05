import { Router } from "express";
import { asyncHandler } from "./lib/asyncHandler";
import * as productController from "./controllers/productController";
import * as authController from "./controllers/authController";
import * as watchlistController from "./controllers/watchlistController";
import * as sourcingController from "./controllers/sourcingController";
import * as billingController from "./controllers/billingController";
import requireAuth from "./middleware/auth";
import { enforceBatchAccess } from "./middleware/access";

export const productRoutes = Router();
export const batchRoutes = Router();
export const watchlistRoutes = Router();
export const authRoutes = Router();
export const sourcingRoutes = Router();
export const billingRoutes = Router();
export const analysisRoutes = Router();
analysisRoutes.post(
  "/product",
  asyncHandler(requireAuth),
  asyncHandler(productController.analyzeProduct),
);

// --- Product Routes ---
productRoutes.get(
  "/featured",
  asyncHandler(productController.getFeaturedProducts),
);
// Get historical data for charts (more specific route first)
productRoutes.use(asyncHandler(requireAuth));
productRoutes.get(
  "/trending",
  asyncHandler(productController.getTrendingProducts),
);
productRoutes.get(
  "/bestsellers",
  asyncHandler(productController.getBestSellerProducts),
);
productRoutes.get(
  "/:asin/history",
  asyncHandler(productController.getProductHistory),
);

// Get single product details (fetches live or DB cache)
productRoutes.get("/:asin", asyncHandler(productController.getProductDetails));

// --- Batch Routes ---
// Bulk analysis
batchRoutes.use(asyncHandler(requireAuth));
batchRoutes.post(
  "/analyze",
  asyncHandler(enforceBatchAccess),
  asyncHandler(productController.analyzeBatch),
);

// --- Watchlist Routes ---
watchlistRoutes.use(asyncHandler(requireAuth));
watchlistRoutes.get("/", asyncHandler(watchlistController.listWatchlist));
watchlistRoutes.post("/", asyncHandler(watchlistController.addToWatchlist));
watchlistRoutes.delete(
  "/:idOrAsin",
  asyncHandler(watchlistController.removeFromWatchlist),
);

// --- Sourcing Routes ---
sourcingRoutes.use(asyncHandler(requireAuth));
sourcingRoutes.get("/", asyncHandler(sourcingController.listSourcingNotes));
sourcingRoutes.post("/", asyncHandler(sourcingController.addSourcingNote));
sourcingRoutes.delete(
  "/:id",
  asyncHandler(sourcingController.deleteSourcingNote),
);

// --- Auth Routes ---
authRoutes.post("/register", asyncHandler(authController.register));
authRoutes.post("/login", asyncHandler(authController.login));
authRoutes.post(
  "/forgot-password",
  asyncHandler(authController.forgotPassword),
);
authRoutes.post("/reset-password", asyncHandler(authController.resetPassword));
authRoutes.get(
  "/me",
  asyncHandler(requireAuth),
  asyncHandler(authController.me),
);
authRoutes.get(
  "/api-keys",
  asyncHandler(requireAuth),
  asyncHandler(authController.listApiKeys),
);
authRoutes.post(
  "/api-keys",
  asyncHandler(requireAuth),
  asyncHandler(authController.createApiKeyHandler),
);

// --- Billing Routes ---
billingRoutes.get("/plans", asyncHandler(billingController.listPlans));
billingRoutes.get(
  "/usage",
  asyncHandler(requireAuth),
  asyncHandler(billingController.usage),
);
billingRoutes.post(
  "/checkout",
  asyncHandler(requireAuth),
  asyncHandler(billingController.checkoutSession),
);

authRoutes.delete(
  "/api-keys/:id",
  asyncHandler(requireAuth),
  asyncHandler(authController.revokeApiKey),
);
