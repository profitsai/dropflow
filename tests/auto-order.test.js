import { describe, it, expect, beforeEach } from 'vitest';
import { resetStorage, getStorage } from './setup.js';
import {
  ORDER_STATUS,
  createOrder,
  getOrders,
  saveOrders,
  updateOrder,
  cancelOrder,
  getOrdersByStatus,
  getPendingOrders,
  confirmOrderPayment,
  getAutoOrderSettings,
  saveAutoOrderSettings,
} from '../extension/lib/auto-order.js';

beforeEach(() => {
  resetStorage();
});

// ============================================================
// ORDER_STATUS constants
// ============================================================
describe('ORDER_STATUS', () => {
  it('has all expected statuses', () => {
    expect(ORDER_STATUS.PENDING).toBe('pending');
    expect(ORDER_STATUS.PROCESSING).toBe('processing');
    expect(ORDER_STATUS.AWAITING_PAYMENT).toBe('awaiting_payment');
    expect(ORDER_STATUS.ORDERED).toBe('ordered');
    expect(ORDER_STATUS.SHIPPED).toBe('shipped');
    expect(ORDER_STATUS.DELIVERED).toBe('delivered');
    expect(ORDER_STATUS.CANCELLED).toBe('cancelled');
    expect(ORDER_STATUS.FAILED).toBe('failed');
  });

  it('has exactly 8 statuses', () => {
    expect(Object.keys(ORDER_STATUS)).toHaveLength(8);
  });
});

// ============================================================
// createOrder
// ============================================================
describe('createOrder', () => {
  it('creates an order with pending status', async () => {
    const order = await createOrder({
      ebayItemId: '123',
      ebayOrderId: 'ORD-001',
      soldPrice: 29.99,
      quantity: 1,
      buyerName: 'Test Buyer',
    });

    expect(order.id).toBeDefined();
    expect(order.status).toBe('pending');
    expect(order.ebayOrderId).toBe('ORD-001');
    expect(order.soldPrice).toBe(29.99);
    expect(order.quantity).toBe(1);
    expect(order.createdAt).toBeDefined();
  });

  it('persists order to storage', async () => {
    await createOrder({ ebayItemId: '123' });
    const orders = await getOrders();
    expect(orders).toHaveLength(1);
  });

  it('defaults missing fields', async () => {
    const order = await createOrder({});
    expect(order.soldPrice).toBe(0);
    expect(order.quantity).toBe(1);
    expect(order.soldCurrency).toBe('USD');
    expect(order.buyerName).toBe('');
    expect(order.sourceType).toBe('unknown');
  });

  it('generates unique IDs for multiple orders', async () => {
    const o1 = await createOrder({ ebayItemId: '1' });
    const o2 = await createOrder({ ebayItemId: '2' });
    expect(o1.id).not.toBe(o2.id);
    const orders = await getOrders();
    expect(orders).toHaveLength(2);
  });

  it('initialises timestamp fields correctly', async () => {
    const order = await createOrder({ ebayItemId: '1' });
    expect(order.createdAt).toBeDefined();
    expect(order.updatedAt).toBeDefined();
    expect(order.orderedAt).toBeNull();
    expect(order.shippedAt).toBeNull();
    expect(order.deliveredAt).toBeNull();
  });

  it('copies source info from tracked products', async () => {
    // Pre-populate tracked products
    const storage = getStorage();
    storage.trackedProducts = [
      { ebayItemId: 'ITEM1', sourceUrl: 'https://amazon.com/dp/B123', sourceType: 'amazon', sourcePrice: 10 }
    ];
    const order = await createOrder({ ebayItemId: 'ITEM1', soldPrice: 25 });
    expect(order.sourceUrl).toBe('https://amazon.com/dp/B123');
    expect(order.sourceType).toBe('amazon');
    expect(order.sourcePrice).toBe(10);
  });

  it('uses saleData source fields when no tracked product match', async () => {
    const order = await createOrder({
      ebayItemId: 'UNKNOWN',
      sourceUrl: 'https://aliexpress.com/item/123.html',
      sourceType: 'aliexpress'
    });
    expect(order.sourceUrl).toBe('https://aliexpress.com/item/123.html');
    expect(order.sourceType).toBe('aliexpress');
  });

  it('preserves buyer address object', async () => {
    const addr = { addressLine1: '123 Main St', city: 'Springfield', state: 'IL', postalCode: '62701' };
    const order = await createOrder({ ebayItemId: '1', buyerAddress: addr });
    expect(order.buyerAddress).toEqual(addr);
  });
});

// ============================================================
// updateOrder
// ============================================================
describe('updateOrder', () => {
  it('updates status and sets updatedAt', async () => {
    const order = await createOrder({ ebayItemId: '1' });
    const updated = await updateOrder(order.id, { status: ORDER_STATUS.PROCESSING });
    expect(updated.status).toBe('processing');
    expect(updated.updatedAt).toBeDefined();
  });

  it('sets orderedAt timestamp when status becomes ORDERED', async () => {
    const order = await createOrder({ ebayItemId: '1' });
    const updated = await updateOrder(order.id, { status: ORDER_STATUS.ORDERED });
    expect(updated.orderedAt).toBeDefined();
  });

  it('does not overwrite orderedAt on subsequent ORDERED updates', async () => {
    const order = await createOrder({ ebayItemId: '1' });
    const first = await updateOrder(order.id, { status: ORDER_STATUS.ORDERED });
    const ts = first.orderedAt;
    const second = await updateOrder(order.id, { status: ORDER_STATUS.ORDERED });
    expect(second.orderedAt).toBe(ts);
  });

  it('sets shippedAt timestamp when status becomes SHIPPED', async () => {
    const order = await createOrder({ ebayItemId: '1' });
    const updated = await updateOrder(order.id, { status: ORDER_STATUS.SHIPPED });
    expect(updated.shippedAt).toBeDefined();
  });

  it('sets deliveredAt timestamp when status becomes DELIVERED', async () => {
    const order = await createOrder({ ebayItemId: '1' });
    const updated = await updateOrder(order.id, { status: ORDER_STATUS.DELIVERED });
    expect(updated.deliveredAt).toBeDefined();
  });

  it('returns error for unknown order', async () => {
    const result = await updateOrder('nonexistent', { status: 'x' });
    expect(result.error).toBe('Order not found');
  });

  it('can update arbitrary fields', async () => {
    const order = await createOrder({ ebayItemId: '1' });
    const updated = await updateOrder(order.id, {
      sourceTrackingNumber: 'TRACK123',
      sourceShippingCarrier: 'USPS'
    });
    expect(updated.sourceTrackingNumber).toBe('TRACK123');
    expect(updated.sourceShippingCarrier).toBe('USPS');
  });

  it('merges updates with existing order data', async () => {
    const order = await createOrder({ ebayItemId: '1', soldPrice: 25 });
    await updateOrder(order.id, { errorMessage: 'test' });
    const orders = await getOrders();
    const found = orders.find(o => o.id === order.id);
    expect(found.soldPrice).toBe(25);
    expect(found.errorMessage).toBe('test');
  });
});

// ============================================================
// cancelOrder
// ============================================================
describe('cancelOrder', () => {
  it('sets status to cancelled', async () => {
    const order = await createOrder({ ebayItemId: '1' });
    const cancelled = await cancelOrder(order.id);
    expect(cancelled.status).toBe('cancelled');
  });

  it('returns error for nonexistent order', async () => {
    const result = await cancelOrder('fake-id');
    expect(result.error).toBe('Order not found');
  });
});

// ============================================================
// getOrdersByStatus
// ============================================================
describe('getOrdersByStatus', () => {
  it('filters by status', async () => {
    await createOrder({ ebayItemId: '1' });
    await createOrder({ ebayItemId: '2' });
    const o3 = await createOrder({ ebayItemId: '3' });
    await updateOrder(o3.id, { status: ORDER_STATUS.ORDERED });

    const pending = await getOrdersByStatus('pending');
    expect(pending).toHaveLength(2);
    const ordered = await getOrdersByStatus('ordered');
    expect(ordered).toHaveLength(1);
  });

  it('returns empty array for no matches', async () => {
    await createOrder({ ebayItemId: '1' });
    const shipped = await getOrdersByStatus('shipped');
    expect(shipped).toHaveLength(0);
  });
});

// ============================================================
// getPendingOrders
// ============================================================
describe('getPendingOrders', () => {
  it('returns pending and awaiting_payment orders', async () => {
    await createOrder({ ebayItemId: '1' });
    const o2 = await createOrder({ ebayItemId: '2' });
    await updateOrder(o2.id, { status: ORDER_STATUS.AWAITING_PAYMENT });
    const o3 = await createOrder({ ebayItemId: '3' });
    await updateOrder(o3.id, { status: ORDER_STATUS.ORDERED });

    const pending = await getPendingOrders();
    expect(pending).toHaveLength(2);
  });

  it('excludes cancelled and failed orders', async () => {
    const o1 = await createOrder({ ebayItemId: '1' });
    const o2 = await createOrder({ ebayItemId: '2' });
    await updateOrder(o1.id, { status: ORDER_STATUS.CANCELLED });
    await updateOrder(o2.id, { status: ORDER_STATUS.FAILED });
    const pending = await getPendingOrders();
    expect(pending).toHaveLength(0);
  });
});

// ============================================================
// confirmOrderPayment
// ============================================================
describe('confirmOrderPayment', () => {
  it('sets status to ordered with source order ID', async () => {
    const order = await createOrder({ ebayItemId: '1' });
    const confirmed = await confirmOrderPayment(order.id, 'SRC-123');
    expect(confirmed.status).toBe('ordered');
    expect(confirmed.sourceOrderId).toBe('SRC-123');
  });

  it('works without source order ID', async () => {
    const order = await createOrder({ ebayItemId: '1' });
    const confirmed = await confirmOrderPayment(order.id);
    expect(confirmed.status).toBe('ordered');
    expect(confirmed.sourceOrderId).toBe('');
  });
});

// ============================================================
// Order state machine / lifecycle
// ============================================================
describe('order state transitions', () => {
  it('follows full happy path: pending → processing → awaiting_payment → ordered → shipped → delivered', async () => {
    const order = await createOrder({ ebayItemId: '1' });
    expect(order.status).toBe('pending');

    let o = await updateOrder(order.id, { status: ORDER_STATUS.PROCESSING });
    expect(o.status).toBe('processing');

    o = await updateOrder(order.id, { status: ORDER_STATUS.AWAITING_PAYMENT });
    expect(o.status).toBe('awaiting_payment');

    o = await confirmOrderPayment(order.id, 'AMZ-999');
    expect(o.status).toBe('ordered');
    expect(o.orderedAt).toBeDefined();

    o = await updateOrder(order.id, { status: ORDER_STATUS.SHIPPED, sourceTrackingNumber: 'TRK1' });
    expect(o.status).toBe('shipped');
    expect(o.shippedAt).toBeDefined();

    o = await updateOrder(order.id, { status: ORDER_STATUS.DELIVERED });
    expect(o.status).toBe('delivered');
    expect(o.deliveredAt).toBeDefined();
  });

  it('can go from pending to failed', async () => {
    const order = await createOrder({ ebayItemId: '1' });
    const o = await updateOrder(order.id, { status: ORDER_STATUS.FAILED, errorMessage: 'no source URL' });
    expect(o.status).toBe('failed');
    expect(o.errorMessage).toBe('no source URL');
  });

  it('can cancel from any pre-ordered state', async () => {
    const o1 = await createOrder({ ebayItemId: '1' });
    await cancelOrder(o1.id);
    const o2 = await createOrder({ ebayItemId: '2' });
    await updateOrder(o2.id, { status: ORDER_STATUS.AWAITING_PAYMENT });
    await cancelOrder(o2.id);
    const orders = await getOrders();
    expect(orders.filter(o => o.status === 'cancelled')).toHaveLength(2);
  });
});

// ============================================================
// Settings
// ============================================================
describe('auto-order settings', () => {
  it('returns defaults when no settings saved', async () => {
    const settings = await getAutoOrderSettings();
    expect(settings.requireManualConfirm).toBe(true);
    expect(settings.enabled).toBe(false);
  });

  it('saves and retrieves settings', async () => {
    await saveAutoOrderSettings({ enabled: true, maxAutoOrderPrice: 50 });
    const settings = await getAutoOrderSettings();
    expect(settings.enabled).toBe(true);
    expect(settings.maxAutoOrderPrice).toBe(50);
  });
});

// ============================================================
// saveOrders / getOrders round-trip
// ============================================================
describe('saveOrders / getOrders', () => {
  it('persists and retrieves order list', async () => {
    const list = [{ id: 'a', status: 'pending' }, { id: 'b', status: 'ordered' }];
    await saveOrders(list);
    const result = await getOrders();
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('a');
  });

  it('returns empty array when storage empty', async () => {
    const orders = await getOrders();
    expect(orders).toEqual([]);
  });
});
