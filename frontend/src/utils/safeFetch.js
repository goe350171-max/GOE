// Safe fetch wrapper that prevents double-reading response body
const safeFetch = async (url, options = {}) => {
  const response = await fetch(url, options);
  
  // Clone response for potential retry or logging
  const clonedResponse = response.clone();
  
  let data;
  const contentType = response.headers.get('content-type');
  
  try {
    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }
  } catch (parseError) {
    // If JSON parsing fails, try text
    try {
      data = await clonedResponse.text();
    } catch (textError) {
      throw new Error('Failed to parse response');
    }
  }
  
  if (!response.ok) {
    const errorMessage = typeof data === 'object' ? JSON.stringify(data) : data;
    throw new Error(errorMessage || `HTTP ${response.status}: ${response.statusText}`);
  }
  
  return data;
};

export default safeFetch;
