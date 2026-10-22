function applyDiscount(total, rate) {
  return Math.round(total * (1 - rate));
}

module.exports = { applyDiscount };