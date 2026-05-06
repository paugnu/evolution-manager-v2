const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Determine database path
const dbPath = path.join(__dirname, 'scheduled_messages.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening SQLite database:', err);
  } else {
    console.log('Successfully connected to SQLite database at:', dbPath);
  }
});

// Initialize database schema
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS scheduled_messages (
      id TEXT PRIMARY KEY,
      instanceName TEXT NOT NULL,
      instanceToken TEXT NOT NULL,
      instanceUrl TEXT,
      remoteJid TEXT NOT NULL,
      canonicalRemoteJid TEXT,
      messageText TEXT NOT NULL,
      scheduledAtUtc TEXT NOT NULL,
      timezone TEXT DEFAULT 'Europe/Madrid',
      status TEXT DEFAULT 'pending', -- pending | processing | sent | failed | cancelled
      attempts INTEGER DEFAULT 0,
      maxAttempts INTEGER DEFAULT 3,
      lastError TEXT,
      sentAtUtc TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      evolutionMessageId TEXT
    )
  `, (err) => {
    if (err) {
      console.error('Error creating scheduled_messages table:', err);
    } else {
      console.log('scheduled_messages table verified/created.');
      // Add column if it doesn't exist for existing databases
      db.run(`ALTER TABLE scheduled_messages ADD COLUMN instanceUrl TEXT`, (alterErr) => {
        if (alterErr) {
          // Silent or verbose debug depending on duplicate column error
          console.log('Database instanceUrl column check completed.');
        } else {
          console.log('Successfully added instanceUrl column to scheduled_messages.');
        }
      });
    }
  });
});

// Helper: Convert local Europe/Madrid time to UTC ISO string using built-in Intl API
function madridToUtc(localStr) {
  // localStr is like "2026-05-06T18:30:00"
  const parsed = new Date(localStr);
  if (isNaN(parsed.getTime())) {
    throw new Error('Invalid date format');
  }
  
  // Get what the local Madrid time represents in system timezone
  const tzString = parsed.toLocaleString('en-US', { timeZone: 'Europe/Madrid' });
  const madridParsed = new Date(tzString);
  
  const diffMs = madridParsed.getTime() - parsed.getTime();
  const utcDate = new Date(parsed.getTime() - diffMs);
  return utcDate.toISOString();
}

// -------------------------------------------------------------
// API ENDPOINTS
// -------------------------------------------------------------

// POST /api/scheduled-messages - Create a scheduled message
app.post('/api/scheduled-messages', (req, requireResponse) => {
  try {
    const {
      instanceName,
      instanceToken,
      instanceUrl,
      remoteJid,
      canonicalRemoteJid,
      messageText,
      scheduledAtLocal,
      delayMinutes,
      timezone = 'Europe/Madrid'
    } = req.body;

    if (!instanceName || !instanceToken || !remoteJid || !messageText) {
      return requireResponse.status(400).json({ error: 'Missing required parameters' });
    }

    if (!messageText.trim()) {
      return requireResponse.status(400).json({ error: 'Message text cannot be empty' });
    }

    let scheduledAtUtc;

    if (delayMinutes !== undefined && scheduledAtLocal !== undefined) {
      return requireResponse.status(400).json({ error: 'Specify either delayMinutes or scheduledAtLocal, not both' });
    }

    if (delayMinutes !== undefined) {
      const minutes = parseInt(delayMinutes, 10);
      if (isNaN(minutes) || minutes <= 0) {
        return requireResponse.status(400).json({ error: 'delayMinutes must be a positive integer' });
      }
      scheduledAtUtc = new Date(Date.now() + minutes * 60000).toISOString();
    } else if (scheduledAtLocal !== undefined) {
      try {
        scheduledAtUtc = madridToUtc(scheduledAtLocal);
      } catch (e) {
        return requireResponse.status(400).json({ error: 'Invalid scheduledAtLocal date format' });
      }
    } else {
      return requireResponse.status(400).json({ error: 'Either delayMinutes or scheduledAtLocal is required' });
    }

    // Validate that scheduled date is in the future
    if (new Date(scheduledAtUtc).getTime() <= Date.now()) {
      return requireResponse.status(400).json({ error: 'Scheduled time must be in the future' });
    }

    const id = uuidv4();
    const now = new Date().toISOString();

    const stmt = db.prepare(`
      INSERT INTO scheduled_messages (
        id, instanceName, instanceToken, instanceUrl, remoteJid, canonicalRemoteJid,
        messageText, scheduledAtUtc, timezone, status, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `);

    stmt.run(
      id, instanceName, instanceToken, instanceUrl || null, remoteJid, canonicalRemoteJid || null,
      messageText.trim(), scheduledAtUtc, timezone, now, now,
      function (err) {
        if (err) {
          console.error('Error saving scheduled message:', err);
          return requireResponse.status(500).json({ error: 'Failed to schedule message' });
        }
        
        // Return the created record
        return requireResponse.status(201).json({
          id,
          instanceName,
          instanceUrl,
          remoteJid,
          canonicalRemoteJid,
          messageText: messageText.trim(),
          scheduledAtUtc,
          timezone,
          status: 'pending',
          attempts: 0,
          maxAttempts: 3,
          createdAt: now,
          updatedAt: now
        });
      }
    );
    stmt.finalize();

  } catch (error) {
    console.error('Exception in POST /api/scheduled-messages:', error);
    return requireResponse.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/scheduled-messages - Get scheduled messages for a contact
app.get('/api/scheduled-messages', (req, res) => {
  const { remoteJid, canonicalRemoteJid } = req.query;

  if (!remoteJid) {
    return res.status(400).json({ error: 'remoteJid query parameter is required' });
  }

  // Find messages where remoteJid or canonicalRemoteJid matches any of the supplied JIDs
  let query = `
    SELECT id, instanceName, remoteJid, canonicalRemoteJid, messageText, 
           scheduledAtUtc, timezone, status, attempts, maxAttempts, lastError, 
           sentAtUtc, createdAt, updatedAt, evolutionMessageId
    FROM scheduled_messages 
    WHERE remoteJid = ?
  `;
  const params = [remoteJid];

  if (canonicalRemoteJid) {
    query += ` OR canonicalRemoteJid = ? OR remoteJid = ?`;
    params.push(canonicalRemoteJid, canonicalRemoteJid);
  }

  query += ` ORDER BY scheduledAtUtc DESC`;

  db.all(query, params, (err, rows) => {
    if (err) {
      console.error('Error fetching scheduled messages:', err);
      return res.status(500).json({ error: 'Failed to retrieve scheduled messages' });
    }
    return res.json(rows);
  });
});

// PATCH /api/scheduled-messages/:id - Update messageText or scheduledAtLocal of a pending message
app.patch('/api/scheduled-messages/:id', (req, res) => {
  const { id } = req.params;
  const { messageText, scheduledAtLocal } = req.body;

  if (!messageText && !scheduledAtLocal) {
    return res.status(400).json({ error: 'Provide messageText or scheduledAtLocal to update' });
  }

  // Verify status is pending
  db.get('SELECT status FROM scheduled_messages WHERE id = ?', [id], (err, row) => {
    if (err) {
      console.error('Error checking message status:', err);
      return res.status(500).json({ error: 'Server error' });
    }

    if (!row) {
      return res.status(404).json({ error: 'Scheduled message not found' });
    }

    if (row.status !== 'pending') {
      return res.status(400).json({ error: 'Only pending messages can be updated' });
    }

    let query = 'UPDATE scheduled_messages SET updatedAt = ?';
    const params = [new Date().toISOString()];

    if (messageText !== undefined) {
      if (!messageText.trim()) {
        return res.status(400).json({ error: 'Message text cannot be empty' });
      }
      query += ', messageText = ?';
      params.push(messageText.trim());
    }

    if (scheduledAtLocal !== undefined) {
      try {
        const scheduledAtUtc = madridToUtc(scheduledAtLocal);
        if (new Date(scheduledAtUtc).getTime() <= Date.now()) {
          return res.status(400).json({ error: 'Scheduled time must be in the future' });
        }
        query += ', scheduledAtUtc = ?';
        params.push(scheduledAtUtc);
      } catch (e) {
        return res.status(400).json({ error: 'Invalid date format' });
      }
    }

    query += ' WHERE id = ? AND status = "pending"';
    params.push(id);

    db.run(query, params, function (err) {
      if (err) {
        console.error('Error updating scheduled message:', err);
        return res.status(500).json({ error: 'Failed to update message' });
      }
      return res.json({ message: 'Scheduled message updated successfully' });
    });
  });
});

// POST /api/scheduled-messages/:id/cancel - Cancel a pending message
app.post('/api/scheduled-messages/:id/cancel', (req, res) => {
  const { id } = req.params;
  const now = new Date().toISOString();

  db.run(
    'UPDATE scheduled_messages SET status = "cancelled", updatedAt = ? WHERE id = ? AND status = "pending"',
    [now, id],
    function (err) {
      if (err) {
        console.error('Error cancelling scheduled message:', err);
        return res.status(500).json({ error: 'Failed to cancel message' });
      }

      if (this.changes === 0) {
        return res.status(400).json({ error: 'Message is not pending or does not exist' });
      }

      return res.json({ message: 'Scheduled message cancelled successfully' });
    }
  );
});

// POST /api/scheduled-messages/:id/send-now - Force send a pending message immediately
app.post('/api/scheduled-messages/:id/send-now', (req, res) => {
  const { id } = req.params;
  const now = new Date().toISOString();

  db.get('SELECT * FROM scheduled_messages WHERE id = ? AND status = "pending"', [id], (err, msg) => {
    if (err || !msg) {
      return res.status(400).json({ error: 'Message is not pending or does not exist' });
    }

    // Trigger sending immediately
    sendScheduledMessage(msg);
    return res.json({ message: 'Sending triggered immediately' });
  });
});

// -------------------------------------------------------------
// WORKER SCHEDULER (Locks and sends pending messages)
// -------------------------------------------------------------

async function sendScheduledMessage(msg) {
  const now = new Date().toISOString();
  
  // 1. Attempt Atomic Lock (pending -> processing)
  db.run(
    'UPDATE scheduled_messages SET status = "processing", updatedAt = ? WHERE id = ? AND status = "pending"',
    [now, msg.id],
    async function (err) {
      if (err) {
        console.error(`[LOCK ERROR] Failed to lock message ${msg.id}:`, err);
        return;
      }

      if (this.changes === 0) {
        // Already locked or sent by another worker loop
        return;
      }

      console.log(`[WORKER] Lock acquired for message ${msg.id}. Dispatching to Evolution API...`);

      try {
        const apiUrl = msg.instanceUrl || process.env.VITE_EVOLUTION_API_URL || 'https://evolution.yogabond.es';

        const payload = {
          number: msg.remoteJid,
          text: msg.messageText
        };

        const response = await axios.post(
          `${apiUrl}/message/sendText/${msg.instanceName}`,
          payload,
          {
            headers: {
              apikey: msg.instanceToken,
              'content-type': 'application/json'
            },
            timeout: 15000
          }
        );

        const evolutionMessageId = response.data?.key?.id || response.data?.id || null;
        console.log(`[WORKER SUCCESS] Message ${msg.id} sent successfully. Evolution ID: ${evolutionMessageId}`);

        // Update to sent
        db.run(
          'UPDATE scheduled_messages SET status = "sent", sentAtUtc = ?, evolutionMessageId = ?, updatedAt = ? WHERE id = ?',
          [new Date().toISOString(), evolutionMessageId, new Date().toISOString(), msg.id]
        );

      } catch (error) {
        const errorMsg = error.response?.data?.message || error.message || 'Unknown network error';
        console.error(`[WORKER FAILURE] Failed to send message ${msg.id}:`, errorMsg);

        const nextAttempts = msg.attempts + 1;
        const maxAttempts = msg.maxAttempts;

        if (nextAttempts < maxAttempts) {
          // Revert to pending for next retry loop
          db.run(
            'UPDATE scheduled_messages SET status = "pending", attempts = ?, lastError = ?, updatedAt = ? WHERE id = ?',
            [nextAttempts, errorMsg, new Date().toISOString(), msg.id]
          );
        } else {
          // Permanently mark as failed
          db.run(
            'UPDATE scheduled_messages SET status = "failed", attempts = ?, lastError = ?, updatedAt = ? WHERE id = ?',
            [nextAttempts, errorMsg, new Date().toISOString(), msg.id]
          );
        }
      }
    }
  );
}

// Background scheduler loop - runs every 15 seconds
setInterval(() => {
  const now = new Date().toISOString();
  db.all(
    'SELECT * FROM scheduled_messages WHERE status = "pending" AND scheduledAtUtc <= ?',
    [now],
    (err, pendingMessages) => {
      if (err) {
        console.error('[SCHEDULER ERROR] Failed to fetch pending messages:', err);
        return;
      }

      if (pendingMessages && pendingMessages.length > 0) {
        console.log(`[SCHEDULER] Found ${pendingMessages.length} pending messages to dispatch.`);
        pendingMessages.forEach((msg) => {
          sendScheduledMessage(msg);
        });
      }
    }
  );
}, 15000);

// Auto-recovery: Revert old stuck "processing" messages back to "pending" on startup
db.serialize(() => {
  const oneHourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
  db.run(
    'UPDATE scheduled_messages SET status = "pending", lastError = "Recovered from stuck processing state" WHERE status = "processing" AND updatedAt < ?',
    [oneHourAgo],
    function (err) {
      if (err) {
        console.error('Error recovering stuck processing messages:', err);
      } else if (this.changes > 0) {
        console.log(`[RECOVERY] Recovered ${this.changes} stuck processing messages.`);
      }
    }
  );
});

// Start Express Server
const PORT = process.env.PORT || 3002;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Scheduled Messages Backend listening on http://0.0.0.0:${PORT}`);
});
