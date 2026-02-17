import { describe, it, expect, beforeEach } from 'vitest';
import { resetStorage, getStorage } from './setup.js';
import {
  ORDER_STATUS,
  createOrder,
  getOrders,
  updateOrder,
  cancelOrder,
  getOrdersByStatus,
  getPendingOrders,
  confirmOrderPayment,
} from '../extension/lib/auto-order.js';

beforeEach(() => {
  resetStorage();
});

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
});

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
});

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
});

describe('cancelOrder', () => {
  it('sets status to cancelled', async () => {
    const order = await createOrder({ ebayItemId: '1' });
    const cancelled = await cancelOrder(order.id);
    expect(cancelled.status).toBe('cancelled');
  });
});

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
});

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
});

describe('confirmOrderPayment', () => {
  it('sets status to ordered with source order ID', async () => {
    const order = await createOrder({ ebayItemId: '1' });
    const confirmed = await confirmOrderPayment(order.id, 'SRC-123');
    expect(confirmed.status).toBe('ordered');
    expect(confirmed.sourceOrderId).toBe('SRC-123');
  });
});
