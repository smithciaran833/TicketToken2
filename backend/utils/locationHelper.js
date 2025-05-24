// backend/utils/locationHelper.js

/**
 * Calculate distance between two coordinates using Haversine formula
 * @param {Number} lat1 - Latitude of first point
 * @param {Number} lon1 - Longitude of first point
 * @param {Number} lat2 - Latitude of second point
 * @param {Number} lon2 - Longitude of second point
 * @returns {Number} Distance in kilometers
 */
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Radius of the earth in km
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
  const distance = R * c; // Distance in km
  return distance;
};

const deg2rad = (deg) => {
  return deg * (Math.PI/180);
};

/**
 * Format address into a standardized string
 * @param {Object} addressObj - Address object with components
 * @returns {String} Formatted address string
 */
const formatAddress = (addressObj) => {
  if (!addressObj) return '';
  
  const components = [];
  if (addressObj.street) components.push(addressObj.street);
  if (addressObj.city) components.push(addressObj.city);
  if (addressObj.state) components.push(addressObj.state);
  if (addressObj.zipCode) components.push(addressObj.zipCode);
  if (addressObj.country) components.push(addressObj.country);
  
  return components.join(', ');
};

/**
 * Convert address string to coordinates using geocoding
 * In a real implementation, this would call a geocoding service like Google Maps
 * This is a placeholder for demonstration
 * @param {String} addressString - Address to geocode
 * @returns {Promise<Array>} Coordinates [longitude, latitude]
 */
const geocodeAddress = async (addressString) => {
  // This would call a geocoding API in a real implementation
  // For now, we'll return a placeholder
  console.log(`Would geocode: ${addressString}`);
  return [0, 0]; // Default coordinates
};

/**
 * Gets nearby cities based on coordinates
 * @param {Number} latitude - Latitude
 * @param {Number} longitude - Longitude
 * @param {Number} radius - Radius in kilometers
 * @returns {Promise<Array>} Array of nearby city names
 */
const getNearbyCities = async (latitude, longitude, radius = 50) => {
  // This would use a cities database or API in a real implementation
  // For now, we'll return a placeholder
  return ['Example City 1', 'Example City 2'];
};

module.exports = {
  calculateDistance,
  formatAddress,
  geocodeAddress,
  getNearbyCities
};
