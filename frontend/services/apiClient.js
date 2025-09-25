/**
 * API Client for WhatsApp Manager
 * Handles all HTTP requests to wa.plest.de backend
 */

class ApiClient {
  constructor() {
    // Use absolute URL for API calls to avoid routing issues
    this.baseURL = '/api';
    this.token = null;

    // Initialize token from localStorage if available
    if (typeof window !== 'undefined') {
      this.token = localStorage.getItem('jwt-token');
    }

    console.log('API Client initialized:', this.baseURL);
  }

  setToken(token) {
    this.token = token;
    if (typeof window !== 'undefined') {
      if (token) {
        localStorage.setItem('jwt-token', token);
      } else {
        localStorage.removeItem('jwt-token');
      }
    }
  }

  getHeaders() {
    const headers = {
      'Content-Type': 'application/json',
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    return headers;
  }

  async request(method, endpoint, data = null) {
    const url = `${this.baseURL}${endpoint}`;

    const config = {
      method,
      headers: this.getHeaders(),
      credentials: 'include', // Important for CORS
    };

    if (data && ['POST', 'PUT', 'PATCH'].includes(method)) {
      config.body = JSON.stringify(data);
    }

    try {
      console.log(`API Request: ${method} ${url}`, { headers: config.headers });

      const response = await fetch(url, config);

      // Handle different response types
      let responseData;
      const contentType = response.headers.get('content-type');

      if (contentType && contentType.includes('application/json')) {
        responseData = await response.json();
      } else {
        responseData = await response.text();
      }

      console.log(`API Response: ${response.status}`, responseData);

      if (!response.ok) {
        throw new Error(responseData.error || responseData.message || `HTTP ${response.status}: ${responseData}`);
      }

      return responseData;
    } catch (error) {
      console.error(`API Request failed (${method} ${endpoint}):`, error);
      throw error;
    }
  }

  // HTTP Methods
  async get(endpoint) {
    return this.request('GET', endpoint);
  }

  async post(endpoint, data) {
    return this.request('POST', endpoint, data);
  }

  async put(endpoint, data) {
    return this.request('PUT', endpoint, data);
  }

  async delete(endpoint) {
    return this.request('DELETE', endpoint);
  }

  // Authentication methods
  async login(email, password) {
    const response = await this.post('/auth/login', { email, password });

    if (response.tokens?.accessToken) {
      this.setToken(response.tokens.accessToken);
    }

    return response;
  }

  async getProfile() {
    return this.get('/auth/me');
  }

  // Instance management methods
  async getInstances() {
    return this.get('/instances');
  }

  async createInstance(instanceData) {
    return this.post('/instances', instanceData);
  }

  async startInstance(instanceId) {
    return this.post(`/instances/${instanceId}/start`);
  }

  async stopInstance(instanceId) {
    return this.post(`/instances/${instanceId}/stop`);
  }

  async deleteInstance(instanceId) {
    return this.delete(`/instances/${instanceId}`);
  }

  async getInstanceQR(instanceId) {
    return this.get(`/instances/${instanceId}/qr`);
  }

  // WhatsApp Proxy methods
  async getProxyMethods() {
    return this.get('/proxy/methods');
  }

  async sendMessage(apiKey, chatId, message) {
    return this.post(`/proxy/${apiKey}/sendMessage`, {
      params: [chatId, message]
    });
  }

  async getChats(apiKey) {
    return this.get(`/proxy/${apiKey}/chats`);
  }

  // Analytics methods
  async getAnalytics() {
    return this.get('/analytics');
  }

  // Health check
  async getHealth() {
    return this.get('/health');
  }
}

// Export singleton instance
const apiClient = new ApiClient();
export default apiClient;