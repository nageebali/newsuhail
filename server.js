//googlestiudio 
//AIzaSyDPMNlDVWUDmd1BwOyIz1yQswpUyY3Xagw
const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const bodyParser = require('body-parser');
const path = require('path');
const { generateKey } = require('crypto');
const uuid = require('uuid');
const { createClient } = require('@supabase/supabase-js');



const bcrypt = require('bcrypt');


require('dotenv').config();

const supabase =createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY);

async function testConnection() {
    try {
      const { data, error } = await supabase
        .from('usersT')
        .select('*')
        .limit(100);
      
      if (error) throw error;
      console.log('✅ تم الاتصال بنجاح:', data);
      return true;
    } catch (err) {
      console.error('❌ فشل الاتصال:', err.message);
      return false;
    }
  }
  
  testConnection();

//   function  CREATETABL(){
//   //  -- جدول المستخدمين
//   SQL="CREATE TABLE IF NOT EXISTS usersT (    id SERIAL PRIMARY KEY,    username TEXT NOT NULL,    password TEXT NOT NULL,    phoneNumber TEXT NOT NULL UNIQUE,    instanstoken TEXT NOT NULL UNIQUE,    is_verified BOOLEAN DEFAULT FALSE,    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);

// //-- جدول جلسات واتساب
// SQL="CREATE TABLE IF NOT EXISTS whatsapp_sessions (    id TEXT PRIMARY KEY,    status TEXT,    qr_code TEXT,    last_activity TIMESTAMP, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, client_data JSONB);"

// SQL="CREATE TABLE IF NOT EXISTS messages (    idSERIAL PRIMARY KEY,    session_id TEXT REFERENCES whatsapp_sessions(id) ON DELETE CASCADE, phonenumber TEXT,    message_text TEXT,    direction TEXT,    status TEXT,    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP);"

// SQL="CREATE TABLE IF NOT EXISTS customers (    idSERIAL PRIMARY KEY,    whatsapp_number TEXT UNIQUE NOT NULL,    customer_name TEXT,    customer_id TEXT UNIQUE,    registration_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP);"

 

// SQL="CREATE TABLE IF NOT EXISTS tbwhatsapp_numbers (    id SERIAL PRIMARY KEY,    sessionId VARCHAR(255),    number VARCHAR(255),    name TEXT,    saved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,    UNIQUE (sessionId, number));"


// SQL="CREATE INDEX IF NOT EXISTS idx_number ON tbwhatsapp_numbers(number);"
// SQL="CREATE INDEX IF NOT EXISTS idx_session ON tbwhatsapp_numbers(sessionId);"

//   }

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));


// استخدم dotenv لتحميل متغيرات البيئة

// Initialize Supabase Client

// Store active clients
const activeClients = new Map();

// نظام المصادقة
app.post('/register/', async (req, res) => {
  try {
    // Destructure with consistent naming
    const { username, password, phoneNumber } = req.body; // Note camelCase

    // Input validation
    if (!phoneNumber) {
      return res.status(400).json({ error: 'رقم الهاتف مطلوب' });
    }
    if (!username || !password) {
      return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبان' });
    }

    // Check if phone exists - using correct variable name
    const { data: existingUser, error: userError } = await supabase
      .from('usersT')
      .select('phoneNumber')
      .eq('phoneNumber', phoneNumber) // ✅ Correct variable
      .single();

    if (existingUser) {
      return res.status(400).json({ error: 'رقم الهاتف مسجل مسبقاً' });
    }

    // Rest of your registration logic...
    const instantToken = uuid.v4();
    
    const { data: newUser, error: insertError } = await supabase
      .from('usersT')
      .insert({
      username,
        password,
        phoneNumber, // Consistent naming
        instantToken
      })
      .select(           );
       
    if (insertError) throw insertError;

    return res.status(201).json({
      success: true,
      user: newUser[0]
    });

  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء التسجيل",
      error: error.message
    });
  }
});

app.post('/api/login', async (req, res) => {
  const { password, phoneNumber } = req.body;
  
  if (!password || !phoneNumber) {
    return res.status(400).json({ error: 'Phone number and password are required' });
  }

  try {
    // First find user by phone number only
    const { data: user, error: findError } = await supabase
      .from('usersT')
      .select() // store hashed passwords, not plain text
      .eq('phoneNumber', phoneNumber)
      .eq('password', password)
      .single();

    if (findError || !user) {
      // Generic error message to prevent user enumeration
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Compare hashed password with input password
    // const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    // if (!isPasswordValid) {
    //   return res.status(401).json({ error: 'Invalid credentials' });
    // }

    // Create a safe user object without sensitive data
    const safeUser = {
      id: user.id,
      username: user.username,
       password:user.password,
      phoneNumber: user.phonenumber, // Consistent naming
      instantToken:user.instantToken

      // Consider issuing a new session token instead of returning instantToken
    };

    return res.json(safeUser);
  } catch (err) {
    console.error('Database error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
// API to create a new session
app.post('/add/:sessionId/', async (req, res) => {

  var sessionId= req.params.sessionId;
  const instantToken=req.body.instanstoken;
  

 // const instantToken = req.headers.authorization?.split(' ')[1];

//  Get user_id from token
  const { data: user, error: userError } = await supabase
    .from('usersT')
    .select('id')
    // .eq('instantToken', instantToken)
    .eq('instantToken', instantToken)
    .single();

  if (userError || !user) {
    return res.status(401).json({ error: 'غير مصرح به' });
  }
  sessionId=user.id;
  if (activeClients.has(sessionId)) {
    return res.status(400).json({ error: 'Session already exists' });
  }

  try {
    // Create a new WhatsApp client
    const client = new Client({
      authStrategy: new LocalAuth({ clientId: sessionId }),
      puppeteer: { 
        headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      }
    });

    // Store QR code in database when generated
  // In your /add/:sessionId/ endpoint
client.on('qr', async (qrCode) => {  // Changed parameter name from qr to qrCode
  try {
      const qrImage = await qrcode.toDataURL(qrCode);
      
      const { error } = await supabase
          .from('whatsapp_sessions')
          .upsert({
              id: sessionId,
              status: 'QR_GENERATED',
              qr_code: qrImage,  // Store the image URL instead of raw QR
              last_activity: new Date().toISOString()
          });

      if (error) throw error;
      console.log(`QR code updated for session ${sessionId}`);
  } catch (err) {
      console.error('QR code save error:', err);
  }
});
    // Update status when ready
    client.on('ready', async () => {
      console.log(`[${sessionId}] Client is ready`);
      activeClients.set(sessionId, client);
    
      try {
        // Add initial delay
        await new Promise(resolve => setTimeout(resolve, 2000));
    
      //  const contacts = await getAllWhatsAppNumbers(client, sessionId);
       // const result = await saveNumbersToDatabase(contacts, sessionId);
    
        await supabase
          .from('whatsapp_sessions')
          .update({
            status: 'READY',
            last_activity: new Date().toISOString(),
            contacts_count: result.count
          })
          .eq('id', sessionId);
    
      } catch (error) {
        console.error(`[${sessionId}] Startup sequence failed:`, error);
      }
    });
    // Handle incoming messages
    client.on('message', async (msg) => {
      if (msg.fromMe) return;
      
      await supabase
        .from('messages')
        .insert({
          session_id: sessionId,
          phonenumber: msg.from,
          message_text: msg.body,
          direction: 'INCOMING',
          status: 'RECEIVED',
          user_id: user.id
        });
    });

    // Handle authentication failure
    client.on('auth_failure', () => {
      console.log(`Authentication failure for session ${sessionId}`);
      supabase
        .from('whatsapp_sessions')
        .update({
          status: 'AUTH_FAILURE'
        })
        .eq('id', sessionId);
    });

    // Handle disconnect
    client.on('disconnected', (reason) => {
      console.log(`Client ${sessionId} disconnected:`, reason);
      activeClients.delete(sessionId);
      
      supabase
        .from('whatsapp_sessions')
        .update({
          status: 'DISCONNECTED'
        })
        .eq('id', sessionId);
    });

    // Initialize the client
    client.initialize();
    
    res.json({ 
      success: true, 
      message: 'Session created successfully', 
      sessionId 
    });
  } catch (error) {
    console.error('Error creating session:', error);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

// API to get session status
app.get('/client-status/:sessionId', async (req, res) => {
  const sessionId = req.params.sessionId;
  
  const { data: session, error } = await supabase
    .from('whatsapp_sessions')
    .select('status, qr_code, last_activity')
    .eq('id', sessionId)
    .single();

  if (error) {
    return res.status(500).json({ error: 'Database error' });
  }
  
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  const response = {
    status: session.status,
    lastActivity: session.last_activity
  };
  
  if (session.status === 'QR_GENERATED') {
    response.qrCode = session.qr_code;
  }
  
  res.json(response);
});

// API to get all active clients
app.get('/clients', async (req, res) => {
  const { data: sessions, error } = await supabase
  .from('whatsapp_sessions')
  .select('id, status, last_activity')
  .eq('status', 'READY');

if (error) {
  return res.status(500).json({ error: 'Database error' });
}

const activeSessions = sessions.map(session => ({
  id: session.id,
  status: session.status,
  lastActivity: session.last_activity
}));

// Reinitialize clients that are in READY state but not in activeClients
   loadAllClients(activeSessions);
       return res.json(activeSessions);

 
});

async function LOADSOSSION(){
  const { data: sessions, error } = await supabase
  .from('whatsapp_sessions')
  .select('id, status, last_activity')
  .eq('status', 'READY');

if (error) {
  return res.status(500).json({ error: 'Database error' });
}

const activeSessions = sessions.map(session => ({
  id: session.id,
  status: session.status,
  lastActivity: session.last_activity
}));

// Reinitialize clients that are in READY state but not in activeClients
   loadAllClients(activeSessions);
  //return res.json(activeSessions);
}

// API to delete a session
// app.delete('/api/session/:sessionId', async (req, res) => {
//   const sessionId = req.params.sessionId;
//   const client = activeClients.get(sessionId);
  
//   if (client) {
//     client.destroy()
//       .then(async () => {
//         activeClients.delete(sessionId);
        
//         await supabase
//           .from('whatsapp_sessions')
//           .delete()
//           .eq('id', sessionId);
        
//         res.json({ success: true, message: 'Session deleted successfully' });
//       })
//       .catch(error => {
//         console.error('Error destroying client:', error);
//         res.status(500).json({ error: 'Failed to delete session' });
//       });
//   } else {
//     await supabase
//       .from('whatsapp_sessions')
//       .delete()
//       .eq('id', sessionId);
    
//     res.json({ success: true, message: 'Session deleted successfully' });
//   }
// });

// API to get all messages
app.get('/messages/:instanstoken', async (req, res) => {
  const instantToken = req.params.instanstoken;

  // Get user from token
  const { data: user, error: userError } = await supabase
    .from('usersT')
    .select('id')
    .eq('instantToken', instantToken)
    .single();

  if (userError || !user) {
    return res.status(401).json({ error: 'غير مصرح به' });
  }

  // Get messages
  const { data: messages, error } = await supabase
    .from('messages')
    .select('id, phonenumber, message_text, direction, status, timestamp')
    .neq('phonenumber', 'status@broadcast')
    .eq('session_id', user.id)
    .order('timestamp', { ascending: false })
    .limit(100);

  if (error) {
    return res.status(500).json({ error: 'خطأ في جلب الرسائل' });
  }

  res.json(messages);
});

// API to send a message
app.post('/send2/:instanstoken', async (req, res) => {
  const instantToken = req.params.instanstoken;
  const { phone, text } = req.body;
  
  if (!phone || !text) {
    return res.status(400).json({ error: 'Phone and text parameters are required' });
  }

  // Get user and session from token
  const { data: user, error: userError } = await supabase
    .from('usersT')
    .select('id')
    .eq('instantToken', instantToken)
    .single();

  if (userError || !user) {
    return res.status(401).json({ error: 'غير مصرح به' });
  }

  const { data: session, error: sessionError } = await supabase
    .from('whatsapp_sessions')
    .select('id')
    .eq('id', user.id)
    .eq('status', 'READY')
    .single();

  if (sessionError || !session) {
    return res.status(404).json({ error: 'No active session found' });
  }

  const client = activeClients.get(session.id);
  if (!client) {
    return res.status(404).json({ error: 'Session not active' });
  }
  
  try {
    // Format phone number
    let formattedPhone = phone.replace(/\D/g, '');
    if (!formattedPhone.endsWith('@c.us')) {
      formattedPhone += '@c.us';
    }
    
    // Send the message
    await client.sendMessage(formattedPhone, text);
    
    // Save to database
    await supabase
      .from('messages')
      .insert({
        session_id: session.id,
        phonenumber: formattedPhone,
        message_text: text,
        direction: 'OUTGOING',
        status: 'SENT',
    
      });
    
    res.json({ success: true, message: 'Message sent successfully' });
  } catch (error) {
    console.error('Error sending message:', error);
    
    // Save failed attempt to database
    await supabase
      .from('messages')
      .insert({
        session_id: session.id,
        phonenumber: phone,
        message_text: text,
        direction: 'OUTGOING',
        status: 'FAILED',
      
      });
    
    res.status(500).json({ error: 'Failed to send message' });
  }
});


app.post('/send/:instanstoken', async (req, res) => {
  const instantToken = req.params.instanstoken;
  const phone = req.query.phone;

   const text = req.query.text;

  if (!phone || !text) {
    return res.status(400).json({ error: 'Phone and text parameters are required' });
  }

  // Get user and session from token
  const { data: user, error: userError } = await supabase
    .from('usersT')
    .select('id')
    .eq('instantToken', instantToken)
    .single();

  if (userError || !user) {
    return res.status(401).json({ error: 'غير مصرح به' });
  }

  const { data: session, error: sessionError } = await supabase
    .from('whatsapp_sessions')
    .select('id')
    .eq('id', user.id)
    .eq('status', 'READY')
    .single();

  if (sessionError || !session) {
    return res.status(404).json({ error: 'No active session found' });
  }

  const client = activeClients.get(session.id);
  if (!client) {
    return res.status(404).json({ error: 'Session not active' });
  }
  
  try {
    // Format phone number
    let formattedPhone = phone.replace(/\D/g, '');
    if (!formattedPhone.endsWith('@c.us')) {
      formattedPhone += '@c.us';
    }
    
    // Send the message
    await client.sendMessage(formattedPhone, text);
    
    // Save to database
    await supabase
      .from('messages')
      .insert({
        session_id: session.id,
        phonenumber: formattedPhone,
        message_text: text,
        direction: 'OUTGOING',
        status: 'SENT',
    
      });
    
    res.json({ success: true, message: 'Message sent successfully' });
  } catch (error) {
    console.error('Error sending message:', error);
    
    // Save failed attempt to database
    await supabase
      .from('messages')
      .insert({
        session_id: session.id,
        phonenumber: phone,
        message_text: text,
        direction: 'OUTGOING',
        status: 'FAILED',
      
      });
    
    res.status(500).json({ error: 'Failed to send message' });
  }
});


// Helper function to load all clients
async function loadAllClients(activeSessions) {
  for (const session of activeSessions) {
    if (!activeClients.has(session.id)) {
      try {
        const client = new Client({
          authStrategy: new LocalAuth({ clientId: session.id }),
          puppeteer: { 
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
          }
        });

        client.on('ready', () => {
          console.log(`Client ${session.id} is ready!`);
          activeClients.set(session.id, client);
        });

        client.on('disconnected', () => {
          activeClients.delete(session.id);
        });

        client.on('auth_failure', () => {
          activeClients.delete(session.id);
          supabase
            .from('whatsapp_sessions')
            .update({
              status: 'AUTH_FAILURE'
            })
            .eq('id', session.id);
        });

        await client.initialize();
      } catch (error) {
        console.error(`Error initializing client ${session.id}:`, error);
      }
    }
  }
}

// Serve static files
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
 
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    console.error('❌ خطأ: متغيرات Supabase البيئية غير معرّفة!');
    console.log('تأكد من:');
    console.log('1. وجود ملف .env في المجلد الرئيسي');
    console.log('2. أن المتغيرات معرّفة بشكل صحيح');
    process.exit(1);
  }
   LOADSOSSION();
});

process.on('SIGINT', async () => {
  console.log('\nGraceful shutdown...');
  for (const [id, client] of activeClients) {
    try {
      await client.destroy();
      console.log(`[${id}] Client destroyed`);
    } catch (err) {
      console.error(`[${id}] Destruction failed:`, err);
    }
  }
  process.exit();
});





async function getAllWhatsAppNumbers(client, sessionId) {
  // Verify client is ready and connected
  if (!client?.info || !client?.pupPage) {
    throw new Error('WhatsApp client is not ready or connected');
  }

  try {
    const [contacts, chats] = await Promise.all([
      client.getContacts(),
      client.getChats()
    ]);

    const numbersMap = new Map();

    // Process contacts
    contacts.forEach(contact => {
      if (contact.number) {
        const cleanNumber = contact.number.replace('@c.us', '').replace('+', '');
        numbersMap.set(cleanNumber, {
          number: cleanNumber,
          name: contact.name || contact.pushname || null,
          sessionId
        });
      }
    });

    // Process chats (non-group chats)
    chats.forEach(chat => {
      if (!chat.isGroup && chat.id?.user) {
        const cleanNumber = chat.id.user.replace(/\D/g, '');
        if (!numbersMap.has(cleanNumber)) {
          numbersMap.set(cleanNumber, {
            number: cleanNumber,
            name: chat.name || chat.pushname || chat.formattedTitle || null,
            sessionId
          });
        }
      }
    });

    return Array.from(numbersMap.values());
    
  } catch (error) {
    console.error('Error fetching WhatsApp numbers:', {
      error: error.message,
      stack: error.stack
    });
    throw new Error(`Failed to get WhatsApp contacts: ${error.message}`);
  }
}

async function saveNumbersToDatabase(numbers, sessionId) {
  if (!numbers || numbers.length === 0) {
    console.warn('No numbers to save');
    return { success: true, count: 0 };
  }

  try {
    // Verify database connection first
    await testConnection();

    // Prepare batch data
    const insertData = numbers.map(numberObj => ({
      sessionid: sessionId,
      number: numberObj.number.replace('+', ''),
      name: numberObj.name || null,
      saved_at: new Date().toISOString()
    }));

    // Split into chunks to avoid timeout
    const chunkSize = 100;
    const chunks = [];
    for (let i = 0; i < insertData.length; i += chunkSize) {
      chunks.push(insertData.slice(i, i + chunkSize));
    }

    let totalSaved = 0;
    
    // Process chunks sequentially
    for (const chunk of chunks) {
      const { error } = await supabase
        .from('tbwhatsapp_numbers')
        .upsert(chunk, { onConflict: 'sessionid,number' });

      if (error) {
        console.error('Error saving chunk:', error);
        throw error;
      }
      totalSaved += chunk.length;
      console.log(`Saved ${chunk.length} numbers (total: ${totalSaved})`);
    }

    // Verify total count
    const { count, error: countError } = await supabase
      .from('tbwhatsapp_numbers')
      .select('*', { count: 'exact', head: true })
      .eq('sessionid', sessionId);

    if (countError) {
      console.error('Count verification error:', countError);
    } else {
      console.log(`Total numbers for session ${sessionId}: ${count}`);
    }

    return { success: true, count: totalSaved };
    
  } catch (error) {
    console.error('Database save error:', {
      message: error.message,
      stack: error.stack,
      sessionId,
      attemptCount: numbers.length
    });
    
    // Retry logic (simple example)
    if (error.message.includes('fetch failed') || error.message.includes('connection')) {
      console.log('Attempting to reconnect...');
      await new Promise(resolve => setTimeout(resolve, 2000));
      return saveNumbersToDatabase(numbers, sessionId); // Recursive retry
    }
    
    throw new Error(`Failed to save contacts after retries: ${error.message}`);
  }
}