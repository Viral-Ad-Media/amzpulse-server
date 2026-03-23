import { Router } from 'express';
import * as productController from './controllers/productController';
import * as authController from './controllers/authController';
import * as watchlistController from './controllers/watchlistController';
import * as sourcingController from './controllers/sourcingController';
import * as billingController from './controllers/billingController';
import requireAuth from './middleware/auth';
import { enforceBatchAccess } from './middleware/access';

export const productRoutes = Router();
export const batchRoutes = Router();
export const watchlistRoutes = Router();
export const authRoutes = Router();
export const sourcingRoutes = Router();
export const billingRoutes = Router();

// --- Product Routes ---
// Get historical data for charts (more specific route first)
productRoutes.get('/:asin/history', productController.getProductHistory);

// Get single product details (fetches live or DB cache)
productRoutes.get('/:asin', productController.getProductDetails);

// --- Batch Routes ---
// Bulk analysis
batchRoutes.use(requireAuth);
batchRoutes.post('/analyze', enforceBatchAccess, productController.analyzeBatch);

// --- Watchlist Routes ---
watchlistRoutes.use(requireAuth);
watchlistRoutes.get('/', watchlistController.listWatchlist);
watchlistRoutes.post('/', watchlistController.addToWatchlist);
watchlistRoutes.delete('/:idOrAsin', watchlistController.removeFromWatchlist);

// --- Sourcing Routes ---
sourcingRoutes.use(requireAuth);
sourcingRoutes.get('/', sourcingController.listSourcingNotes);
sourcingRoutes.post('/', sourcingController.addSourcingNote);
sourcingRoutes.delete('/:id', sourcingController.deleteSourcingNote);

// --- Auth Routes ---
authRoutes.post('/register', authController.register);
authRoutes.post('/login', authController.login);
authRoutes.get('/me', requireAuth, authController.me);
authRoutes.get('/api-keys', requireAuth, authController.listApiKeys);
authRoutes.post('/api-keys', requireAuth, authController.createApiKeyHandler);

// --- Billing Routes ---
billingRoutes.get('/plans', billingController.listPlans);
billingRoutes.get('/usage', requireAuth, billingController.usage);
billingRoutes.post('/checkout', requireAuth, billingController.checkoutSession);
