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

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY);

async function testConnection() {
    try {
      const { data, error } = await supabase
        .from('gaid')
        .select('*')
        .limit(1);
      
      if (error) throw error;
      console.log('✅ تم الاتصال بنجاح:', data);
      return true;
    } catch (err) {
      console.error('❌ فشل الاتصال:', err.message);
      return false;
    }
}
  
testConnection();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Store active clients
const activeClients = new Map();

// نظام المصادقة
app.post('/register/', async (req, res) => {
  try {
    const { username, password, phoneNumber } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({ error: 'رقم الهاتف مطلوب' });
    }
    if (!username || !password) {
      return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبان' });
    }

    const { data: existingUser, error: userError } = await supabase
      .from('usersT')
      .select('phoneNumber')
      .eq('phoneNumber', phoneNumber)
      .single();

    if (existingUser) {
      return res.status(400).json({ error: 'رقم الهاتف مسجل مسبقاً' });
    }

    const instantToken = uuid.v4();
    
    const { data: newUser, error: insertError } = await supabase
      .from('usersT')
      .insert({
        username,
        password,
        phoneNumber,
        instantToken
      })
      .select();
       
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
    const { data: user, error: findError } = await supabase
      .from('usersT')
      .select()
      .eq('phoneNumber', phoneNumber)
      .eq('password', password)
      .single();

    if (findError || !user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const safeUser = {
      id: user.id,
      username: user.username,
      password: user.password,
      phoneNumber: user.phonenumber,
      instantToken: user.instantToken
    };

    return res.json(safeUser);
  } catch (err) {
    console.error('Database error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// API to create a new session
app.post('/add/:sessionId/', async (req, res) => {
  let sessionId = req.params.sessionId;
  const instantToken = req.body.instanstoken;

  const { data: user, error: userError } = await supabase
    .from('usersT')
    .select('id')
    .eq('instantToken', instantToken)
    .single();

  if (userError || !user) {
    return res.status(401).json({ error: 'غير مصرح به' });
  }
  
  sessionId = user.id;
  
  if (activeClients.has(sessionId)) {
    return res.status(400).json({ error: 'Session already exists' });
  }

  try {
    const client = new Client({
      authStrategy: new LocalAuth({ clientId: sessionId }),
      puppeteer: { 
        headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      }
    });

    client.on('qr', async (qrCode) => {
      try {
        const qrImage = await qrcode.toDataURL(qrCode);
        
        const { error } = await supabase
          .from('whatsapp_sessions')
          .upsert({
            id: sessionId,
            status: 'QR_GENERATED',
            qr_code: qrImage,
            last_activity: new Date().toISOString()
          });

        if (error) throw error;
        console.log(`QR code updated for session ${sessionId}`);
      } catch (err) {
        console.error('QR code save error:', err);
      }
    });

    client.on('ready', async () => {
      console.log(`[${sessionId}] Client is ready`);
      activeClients.set(sessionId, client);
    
      try {
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // تم إزالة الجزء الذي يسبب المشكلة واستبداله بالبديل الآمن
        let contactsCount = 0;
        try {
          const contacts = await getAllWhatsAppNumbers(client, sessionId);
          const saveResult = await saveNumbersToDatabase(contacts, sessionId);
          contactsCount = saveResult.count || 0;
        } catch (saveError) {
          console.error('Failed to save contacts:', saveError);
        }
        
        await supabase
          .from('whatsapp_sessions')
          .update({
            status: 'READY',
            last_activity: new Date().toISOString(),
            contacts_count: contactsCount
          })
          .eq('id', sessionId);
      } catch (error) {
        console.error(`[${sessionId}] Startup sequence failed:`, error);
      }
    });

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
         
        });
    });

    client.on('auth_failure', () => {
      console.log(`Authentication failure for session ${sessionId}`);
      supabase
        .from('whatsapp_sessions')
        .update({
          status: 'AUTH_FAILURE'
        })
        .eq('id', sessionId);
    });

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

// ... (بقية ال APIs والأكواد تبقى كما هي دون تغيير)

// Start the server
app.listen(PORT, async() => {
  console.log(`Server running on port ${PORT}`);
 
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    console.error('❌ خطأ: متغيرات Supabase البيئية غير معرّفة!');
    console.log('تأكد من:');
    console.log('1. وجود ملف .env في المجلد الرئيسي');
    console.log('2. أن المتغيرات معرّفة بشكل صحيح');
    process.exit(1);
  }
  await loadSessions();
});
async function loadAllClients(sessions) {
    for (const session of sessions) {
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
  
          await client.initialize();
        } catch (error) {
          console.error(`Error initializing client ${session.id}:`, error);
        }
      }
    }
  }
// تعريف الدوال المساعدة في نهاية الملف (قبل app.listen)

async function loadSessions() {
    try {
      const { data: sessions, error } = await supabase
        .from('whatsapp_sessions')
        .select('id, status, last_activity')
        .eq('status', 'READY');
  
      if (error) throw error;
  
      await loadAllClients(sessions);
    } catch (error) {
      console.error('Failed to load sessions:', error);
    }
  }
  
// ... (بقية الدوال المساعدة تبقى كما هي)