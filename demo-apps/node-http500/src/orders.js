const orders = new Map([
  ['1', { id: '1', customer: 'sara', items: [{ sku: 'tea', qty: 2, price: 120000 }] }],
  // an order whose items were never loaded (e.g. created by an old client)
  ['2', { id: '2', customer: 'reza' }],
  ['3', { id: '3', customer: 'nima', items: [] }],
]);

function findOrder(id) {
  return orders.get(String(id));
}

function summarize(order) {
  // BUG (intentional): `order.items` can be undefined → TypeError → HTTP 500.
  const count = order.items.length;
  const total = order.items.reduce((s, i) => s + i.qty * i.price, 0);
  return { id: order.id, customer: order.customer, count, total };
}

module.exports = { findOrder, summarize };