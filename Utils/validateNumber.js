function validateNumber(num) {
  const parsed = parseInt(Math.abs(Number(num)));
  return isNaN(parsed) ? 0 : parsed;
}


module.exports = validateNumber