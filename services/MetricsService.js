const { logger } = require('../utils/logger');
const Instance = require('../models/Instance');
const Message = require('../models/Message');
const User = require('../models/User');

/**
 * Metrics Service für Prometheus-Integration
 */
class MetricsService {
  constructor(instanceManager) {
    this.instanceManager = instanceManager;
    this.metricsCache = new Map();
    this.cacheTimeout = 30000; // 30 Sekunden Cache
    this.startTime = Date.now();
  }

  /**
   * Prometheus-Format Metriken generieren
   */
  async generatePrometheusMetrics() {
    const cacheKey = 'prometheus_metrics';
    const cached = this.metricsCache.get(cacheKey);

    if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout) {
      return cached.data;
    }

    try {
      const metrics = await this.collectAllMetrics();
      const prometheusFormat = this.formatForPrometheus(metrics);

      this.metricsCache.set(cacheKey, {
        data: prometheusFormat,
        timestamp: Date.now()
      });

      return prometheusFormat;
    } catch (error) {
      logger.error('Failed to generate Prometheus metrics:', error);
      return this.getErrorMetrics();
    }
  }

  /**
   * Alle System-Metriken sammeln
   */
  async collectAllMetrics() {
    const [
      systemMetrics,
      instanceMetrics,
      messageMetrics,
      userMetrics,
      performanceMetrics
    ] = await Promise.all([
      this.getSystemMetrics(),
      this.getInstanceMetrics(),
      this.getMessageMetrics(),
      this.getUserMetrics(),
      this.getPerformanceMetrics()
    ]);

    return {
      system: systemMetrics,
      instances: instanceMetrics,
      messages: messageMetrics,
      users: userMetrics,
      performance: performanceMetrics,
      timestamp: Date.now()
    };
  }

  /**
   * System-Metriken
   */
  async getSystemMetrics() {
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    return {
      uptime_seconds: uptime,
      memory_usage_bytes: {
        rss: memUsage.rss,
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        external: memUsage.external
      },
      cpu_usage_microseconds: {
        user: cpuUsage.user,
        system: cpuUsage.system
      },
      nodejs_version: process.version,
      pid: process.pid
    };
  }

  /**
   * Instance-Metriken
   */
  async getInstanceMetrics() {
    const instances = Array.from(this.instanceManager.instances.values());

    // Status-Verteilung
    const statusCounts = {};
    const serverInstances = await Instance.find({
      serverId: this.instanceManager.serverId
    });

    serverInstances.forEach(instance => {
      statusCounts[instance.status] = (statusCounts[instance.status] || 0) + 1;
    });

    // Resource-Usage
    let totalMemory = 0;
    let totalCpu = 0;
    let healthyInstances = 0;
    let errorInstances = 0;

    for (const instanceData of instances) {
      const { instance } = instanceData;
      totalMemory += instance.resourceUsage.memory || 0;
      totalCpu += instance.resourceUsage.cpu || 0;

      if (instance.isHealthy()) {
        healthyInstances++;
      } else {
        errorInstances++;
      }
    }

    return {
      total_instances: instances.length,
      status_counts: statusCounts,
      healthy_instances: healthyInstances,
      error_instances: errorInstances,
      total_memory_mb: totalMemory,
      total_cpu_percent: totalCpu,
      average_memory_mb: instances.length ? totalMemory / instances.length : 0,
      average_cpu_percent: instances.length ? totalCpu / instances.length : 0,
      server_id: this.instanceManager.serverId
    };
  }

  /**
   * Message-Metriken
   */
  async getMessageMetrics() {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const lastHour = new Date(now.getTime() - 60 * 60 * 1000);

    const [
      total,
      last24hStats,
      lastHourStats
    ] = await Promise.all([
      Message.countDocuments({}),
      Message.aggregate([
        { $match: { createdAt: { $gte: last24h } } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            sent: { $sum: { $cond: [{ $eq: ['$direction', 'outbound'] }, 1, 0] } },
            received: { $sum: { $cond: [{ $eq: ['$direction', 'inbound'] }, 1, 0] } },
            media: { $sum: { $cond: ['$media.hasMedia', 1, 0] } }
          }
        }
      ]),
      Message.aggregate([
        { $match: { createdAt: { $gte: lastHour } } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            sent: { $sum: { $cond: [{ $eq: ['$direction', 'outbound'] }, 1, 0] } },
            received: { $sum: { $cond: [{ $eq: ['$direction', 'inbound'] }, 1, 0] } }
          }
        }
      ])
    ]);

    const last24hData = last24hStats[0] || { total: 0, sent: 0, received: 0, media: 0 };
    const lastHourData = lastHourStats[0] || { total: 0, sent: 0, received: 0 };

    return {
      total_messages: total,
      last_24h: last24hData,
      last_hour: lastHourData,
      messages_per_second: lastHourData.total / 3600,
      sent_received_ratio: lastHourData.received ? lastHourData.sent / lastHourData.received : 0
    };
  }

  /**
   * User-Metriken
   */
  async getUserMetrics() {
    const [
      totalUsers,
      activeUsers,
      planDistribution
    ] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ isActive: true }),
      User.aggregate([
        {
          $group: {
            _id: '$plan',
            count: { $sum: 1 }
          }
        }
      ])
    ]);

    const planCounts = {};
    planDistribution.forEach(item => {
      planCounts[item._id] = item.count;
    });

    return {
      total_users: totalUsers,
      active_users: activeUsers,
      inactive_users: totalUsers - activeUsers,
      plan_distribution: planCounts
    };
  }

  /**
   * Performance-Metriken
   */
  async getPerformanceMetrics() {
    // Event Loop Lag messen
    const start = process.hrtime.bigint();
    await new Promise(resolve => setImmediate(resolve));
    const lag = Number(process.hrtime.bigint() - start) / 1000000; // Convert to milliseconds

    return {
      event_loop_lag_ms: lag,
      gc_runs: process.memoryUsage().external, // Approximation
      open_handles: process._getActiveHandles().length,
      open_requests: process._getActiveRequests().length
    };
  }

  /**
   * Formatierung für Prometheus
   */
  formatForPrometheus(metrics) {
    let output = '';

    // System metrics
    output += `# HELP whatsapp_manager_uptime_seconds Total uptime in seconds\n`;
    output += `# TYPE whatsapp_manager_uptime_seconds counter\n`;
    output += `whatsapp_manager_uptime_seconds ${metrics.system.uptime_seconds}\n\n`;

    output += `# HELP whatsapp_manager_memory_usage_bytes Memory usage in bytes\n`;
    output += `# TYPE whatsapp_manager_memory_usage_bytes gauge\n`;
    Object.entries(metrics.system.memory_usage_bytes).forEach(([type, value]) => {
      output += `whatsapp_manager_memory_usage_bytes{type="${type}"} ${value}\n`;
    });
    output += '\n';

    // Instance metrics
    output += `# HELP whatsapp_manager_instances_total Total number of instances\n`;
    output += `# TYPE whatsapp_manager_instances_total gauge\n`;
    output += `whatsapp_manager_instances_total ${metrics.instances.total_instances}\n\n`;

    output += `# HELP whatsapp_manager_instances_by_status Number of instances by status\n`;
    output += `# TYPE whatsapp_manager_instances_by_status gauge\n`;
    Object.entries(metrics.instances.status_counts).forEach(([status, count]) => {
      output += `whatsapp_manager_instances_by_status{status="${status}"} ${count}\n`;
    });
    output += '\n';

    output += `# HELP whatsapp_manager_instances_healthy Number of healthy instances\n`;
    output += `# TYPE whatsapp_manager_instances_healthy gauge\n`;
    output += `whatsapp_manager_instances_healthy ${metrics.instances.healthy_instances}\n\n`;

    output += `# HELP whatsapp_manager_instance_memory_mb Total memory usage of all instances\n`;
    output += `# TYPE whatsapp_manager_instance_memory_mb gauge\n`;
    output += `whatsapp_manager_instance_memory_mb ${metrics.instances.total_memory_mb}\n\n`;

    // Message metrics
    output += `# HELP whatsapp_manager_messages_total Total number of messages\n`;
    output += `# TYPE whatsapp_manager_messages_total counter\n`;
    output += `whatsapp_manager_messages_total ${metrics.messages.total_messages}\n\n`;

    output += `# HELP whatsapp_manager_messages_24h Messages in the last 24 hours\n`;
    output += `# TYPE whatsapp_manager_messages_24h gauge\n`;
    output += `whatsapp_manager_messages_24h{direction="total"} ${metrics.messages.last_24h.total}\n`;
    output += `whatsapp_manager_messages_24h{direction="sent"} ${metrics.messages.last_24h.sent}\n`;
    output += `whatsapp_manager_messages_24h{direction="received"} ${metrics.messages.last_24h.received}\n\n`;

    output += `# HELP whatsapp_manager_messages_per_second Messages per second rate\n`;
    output += `# TYPE whatsapp_manager_messages_per_second gauge\n`;
    output += `whatsapp_manager_messages_per_second ${metrics.messages.messages_per_second.toFixed(4)}\n\n`;

    // User metrics
    output += `# HELP whatsapp_manager_users_total Total number of users\n`;
    output += `# TYPE whatsapp_manager_users_total gauge\n`;
    output += `whatsapp_manager_users_total {status="total"} ${metrics.users.total_users}\n`;
    output += `whatsapp_manager_users_total {status="active"} ${metrics.users.active_users}\n`;
    output += `whatsapp_manager_users_total {status="inactive"} ${metrics.users.inactive_users}\n\n`;

    // Performance metrics
    output += `# HELP whatsapp_manager_event_loop_lag_ms Event loop lag in milliseconds\n`;
    output += `# TYPE whatsapp_manager_event_loop_lag_ms gauge\n`;
    output += `whatsapp_manager_event_loop_lag_ms ${metrics.performance.event_loop_lag_ms.toFixed(2)}\n\n`;

    return output;
  }

  /**
   * Error-Metriken bei Fehlern
   */
  getErrorMetrics() {
    return `# HELP whatsapp_manager_metrics_error Metrics collection error
# TYPE whatsapp_manager_metrics_error gauge
whatsapp_manager_metrics_error 1
`;
  }

  /**
   * Health-Check-Daten
   */
  async getHealthCheck() {
    try {
      const instances = Array.from(this.instanceManager.instances.values());
      const dbConnected = await this.checkDatabaseConnection();

      const healthyInstances = instances.filter(({ instance }) => instance.isHealthy()).length;
      const totalInstances = instances.length;

      const health = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: Math.floor((Date.now() - this.startTime) / 1000),
        version: require('../../package.json').version,
        environment: process.env.NODE_ENV || 'development',
        server_id: this.instanceManager.serverId,
        database: {
          connected: dbConnected,
          status: dbConnected ? 'healthy' : 'error'
        },
        instances: {
          total: totalInstances,
          healthy: healthyInstances,
          unhealthy: totalInstances - healthyInstances,
          health_percentage: totalInstances ? Math.round((healthyInstances / totalInstances) * 100) : 100
        },
        memory: {
          used_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          total_mb: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
        },
        system: {
          platform: process.platform,
          node_version: process.version,
          pid: process.pid
        }
      };

      // Overall health status
      if (!dbConnected || healthyInstances < totalInstances * 0.8) {
        health.status = 'degraded';
      }

      if (!dbConnected || healthyInstances < totalInstances * 0.5) {
        health.status = 'unhealthy';
      }

      return health;
    } catch (error) {
      logger.error('Health check failed:', error);
      return {
        status: 'error',
        timestamp: new Date().toISOString(),
        error: error.message,
        uptime: Math.floor((Date.now() - this.startTime) / 1000)
      };
    }
  }

  /**
   * Database-Verbindung prüfen
   */
  async checkDatabaseConnection() {
    try {
      const mongoose = require('mongoose');
      return mongoose.connection.readyState === 1;
    } catch (error) {
      return false;
    }
  }
}

module.exports = MetricsService;