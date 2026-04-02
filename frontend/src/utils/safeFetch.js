// Safe fetch wrapper - NO CLONE, single read pattern
const safeFetch = async (url, options = {}) => {
  const res = await fetch(url, options);
  
  let data;
  const contentType = res.headers.get('content-type');
  
  try {
    if (contentType && contentType.includes('application/json')) {
      data = await res.json();
    } else {
      data = await res.text();
    }
  } catch (parseError) {
    throw new Error(`Failed to parse response: ${parseError.message}`);
  }
  
  if (!res.ok) {
    const errorMessage = typeof data === 'object' ? JSON.stringify(data) : data;
    throw new Error(errorMessage || `HTTP ${res.status}: ${res.statusText}`);
  }
  
  return data;
};

export default safeFetch;
