function price(items) {
  return items.reduce((s, i) => s + i.qty * i.unit, 0);
}

module.exports = { price };