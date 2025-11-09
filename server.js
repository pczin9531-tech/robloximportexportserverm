// ===================================================
// SERVIDOR ROBLOX IMPORT/EXPORT - VERSÃO COMPLETA
// Deploy: Render.com
// ===================================================

const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
const cors = require('cors');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 10000;

// ===================================================
// CONFIGURAÇÕES
// ===================================================

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cors());

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100 // Máximo de 100 requisições
});
app.use(limiter);

// ===================================================
// ARMAZENAMENTO DE API KEYS (30 minutos)
// ===================================================

const apiKeys = new Map();

// Limpa keys expiradas a cada 5 minutos
setInterval(() => {
    const now = Date.now();
    for (const [hash, data] of apiKeys.entries()) {
        if (now > data.expiresAt) {
            apiKeys.delete(hash);
            console.log(`🗑️  Key expirada removida: ${hash.substring(0, 8)}...`);
        }
    }
}, 5 * 60 * 1000);

function hashKey(key) {
    return crypto.createHash('sha256').update(key).digest('hex');
}

function storeKey(apiKey) {
    const hash = hashKey(apiKey);
    apiKeys.set(hash, {
        key: apiKey,
        createdAt: Date.now(),
        expiresAt: Date.now() + (30 * 60 * 1000) // 30 minutos
    });
    console.log(`✅ Nova key armazenada: ${hash.substring(0, 8)}...`);
    return hash;
}

function getKey(apiKey) {
    const hash = hashKey(apiKey);
    const data = apiKeys.get(hash);
    if (!data || Date.now() > data.expiresAt) {
        apiKeys.delete(hash);
        return null;
    }
    return data.key;
}

// ===================================================
// FUNÇÕES DE CONVERSÃO ROBLOX
// ===================================================

function createRBXMX(jsonData) {
    const data = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;
    
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<roblox version="4">\n';
    
    if (data.objects && Array.isArray(data.objects)) {
        for (const obj of data.objects) {
            xml += objectToXML(obj, 1);
        }
    }
    
    xml += '</roblox>';
    return xml;
}

function objectToXML(obj, indent = 0) {
    const tabs = '  '.repeat(indent);
    let xml = `${tabs}<Item class="${escapeXML(obj.ClassName)}" referent="RBX${generateId()}">\n`;
    
    xml += `${tabs}  <Properties>\n`;
    xml += `${tabs}    <string name="Name">${escapeXML(obj.Name)}</string>\n`;
    
    for (const [propName, propValue] of Object.entries(obj.Properties || {})) {
        xml += propertyToXML(propName, propValue, indent + 2);
    }
    
    xml += `${tabs}  </Properties>\n`;
    
    if (obj.Children && obj.Children.length > 0) {
        for (const child of obj.Children) {
            xml += objectToXML(child, indent + 1);
        }
    }
    
    xml += `${tabs}</Item>\n`;
    return xml;
}

function propertyToXML(name, value, indent) {
    const tabs = '  '.repeat(indent);
    
    if (!value || typeof value !== 'object') {
        return `${tabs}<string name="${escapeXML(name)}">${escapeXML(String(value))}</string>\n`;
    }
    
    const type = value.type;
    
    switch (type) {
        case 'Vector3':
            return `${tabs}<Vector3 name="${escapeXML(name)}">\n` +
                   `${tabs}  <X>${value.x || 0}</X>\n` +
                   `${tabs}  <Y>${value.y || 0}</Y>\n` +
                   `${tabs}  <Z>${value.z || 0}</Z>\n` +
                   `${tabs}</Vector3>\n`;
        
        case 'CFrame':
            const c = value.components || [0,0,0,1,0,0,0,1,0,0,0,1];
            return `${tabs}<CoordinateFrame name="${escapeXML(name)}">\n` +
                   `${tabs}  <X>${c[0]}</X><Y>${c[1]}</Y><Z>${c[2]}</Z>\n` +
                   `${tabs}  <R00>${c[3]}</R00><R01>${c[4]}</R01><R02>${c[5]}</R02>\n` +
                   `${tabs}  <R10>${c[6]}</R10><R11>${c[7]}</R11><R12>${c[8]}</R12>\n` +
                   `${tabs}  <R20>${c[9]}</R20><R21>${c[10]}</R21><R22>${c[11]}</R22>\n` +
                   `${tabs}</CoordinateFrame>\n`;
        
        case 'Color3':
            return `${tabs}<Color3 name="${escapeXML(name)}">\n` +
                   `${tabs}  <R>${value.r || 0}</R>\n` +
                   `${tabs}  <G>${value.g || 0}</G>\n` +
                   `${tabs}  <B>${value.b || 0}</B>\n` +
                   `${tabs}</Color3>\n`;
        
        default:
            return `${tabs}<string name="${escapeXML(name)}">${escapeXML(String(value.value || ''))}</string>\n`;
    }
}

function escapeXML(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function generateId() {
    return crypto.randomBytes(16).toString('hex');
}

// ===================================================
// FUNÇÕES ROBLOX API
// ===================================================

async function uploadToRoblox(apiKey, fileBuffer, assetType, name, description) {
    try {
        const form = new FormData();
        form.append('file', fileBuffer, { filename: `${name}.rbxm` });
        
        const response = await axios.post(
            'https://data.roblox.com/Data/Upload.ashx',
            form,
            {
                headers: {
                    ...form.getHeaders(),
                    'Cookie': `.ROBLOSECURITY=${apiKey}`
                },
                params: {
                    assetType: assetType,
                    name: name,
                    description: description || '',
                    genreTypeId: 1
                }
            }
        );
        
        return { success: true, assetId: response.data };
    } catch (error) {
        console.error('❌ Erro upload Roblox:', error.message);
        return { success: false, error: error.message };
    }
}

// ===================================================
// ROTAS
// ===================================================

// Página inicial
app.get('/', (req, res) => {
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);
    
    res.send(`
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Roblox Import/Export Server</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: 'Segoe UI', system-ui, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .container {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            max-width: 800px;
            width: 100%;
            padding: 40px;
        }
        h1 { 
            color: #667eea; 
            font-size: 2.5em;
            margin-bottom: 10px;
            text-align: center;
        }
        .status-badge {
            display: inline-block;
            background: #10b981;
            color: white;
            padding: 8px 20px;
            border-radius: 20px;
            font-weight: bold;
            margin: 10px auto 30px;
            display: block;
            width: fit-content;
            animation: pulse 2s infinite;
        }
        @keyframes pulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.05); }
        }
        .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 15px;
            margin: 30px 0;
        }
        .stat-card {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 20px;
            border-radius: 15px;
            text-align: center;
        }
        .stat-value {
            font-size: 2em;
            font-weight: bold;
            display: block;
        }
        .stat-label {
            font-size: 0.9em;
            opacity: 0.9;
            margin-top: 5px;
        }
        .endpoint {
            background: #f8fafc;
            border-left: 4px solid #667eea;
            padding: 15px 20px;
            margin: 10px 0;
            border-radius: 8px;
        }
        .endpoint-method {
            background: #667eea;
            color: white;
            padding: 4px 12px;
            border-radius: 5px;
            font-weight: bold;
            font-size: 0.85em;
            display: inline-block;
            margin-right: 10px;
        }
        .endpoint-path {
            color: #334155;
            font-family: 'Courier New', monospace;
            font-weight: bold;
        }
        .endpoint-desc {
            color: #64748b;
            margin-top: 8px;
            font-size: 0.9em;
        }
        code {
            background: #1e293b;
            color: #10b981;
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 0.9em;
        }
        .section {
            margin: 30px 0;
        }
        .section-title {
            color: #334155;
            font-size: 1.5em;
            margin-bottom: 15px;
            padding-bottom: 10px;
            border-bottom: 2px solid #e2e8f0;
        }
        .footer {
            text-align: center;
            color: #64748b;
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #e2e8f0;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🎮 Roblox Import/Export Server</h1>
        <div class="status-badge">✅ SERVER ONLINE</div>
        
        <div class="stats">
            <div class="stat-card">
                <span class="stat-value">${apiKeys.size}</span>
                <span class="stat-label">API Keys Ativas</span>
            </div>
            <div class="stat-card">
                <span class="stat-value">${hours}h ${minutes}m</span>
                <span class="stat-label">Uptime</span>
            </div>
            <div class="stat-card">
                <span class="stat-value">${PORT}</span>
                <span class="stat-label">Porta</span>
            </div>
        </div>
        
        <div class="section">
            <h2 class="section-title">📡 Endpoints Disponíveis</h2>
            
            <div class="endpoint">
                <span class="endpoint-method">POST</span>
                <span class="endpoint-path">/api/key/generate</span>
                <div class="endpoint-desc">Gera uma nova API Key válida por 30 minutos</div>
                <div class="endpoint-desc"><code>{"userId": 123, "username": "Player"}</code></div>
            </div>
            
            <div class="endpoint">
                <span class="endpoint-method">POST</span>
                <span class="endpoint-path">/api/key/delete</span>
                <div class="endpoint-desc">Remove uma API Key do sistema</div>
                <div class="endpoint-desc"><code>{"key": "sua-key-aqui"}</code></div>
            </div>
            
            <div class="endpoint">
                <span class="endpoint-method">POST</span>
                <span class="endpoint-path">/api/export</span>
                <div class="endpoint-desc">Exporta modelos do Roblox para arquivo</div>
                <div class="endpoint-desc"><code>{"apiKey": "...", "data": {...}, "name": "Model"}</code></div>
            </div>
            
            <div class="endpoint">
                <span class="endpoint-method">POST</span>
                <span class="endpoint-path">/api/import</span>
                <div class="endpoint-desc">Importa modelos externos para o Roblox</div>
                <div class="endpoint-desc"><code>{"apiKey": "...", "source": "assetId", "sourceValue": "123"}</code></div>
            </div>
            
            <div class="endpoint">
                <span class="endpoint-method">GET</span>
                <span class="endpoint-path">/api/status</span>
                <div class="endpoint-desc">Verifica o status e estatísticas do servidor</div>
            </div>
        </div>
        
        <div class="footer">
            <p>🚀 Servidor desenvolvido para Roblox Studio Mobile</p>
            <p style="margin-top: 10px;">Deploy: Render.com | Versão: 1.0.0</p>
        </div>
    </div>
</body>
</html>
    `);
});

// Status do servidor
app.get('/api/status', (req, res) => {
    res.json({
        status: 'online',
        timestamp: new Date().toISOString(),
        apiKeys: apiKeys.size,
        uptime: process.uptime(),
        port: PORT,
        version: '1.0.0'
    });
});

// Gerar API Key
app.post('/api/key/generate', (req, res) => {
    try {
        const { userId, username } = req.body;
        
        // Gera key aleatória
        const apiKey = crypto.randomBytes(32).toString('hex');
        
        // Armazena
        storeKey(apiKey);
        
        console.log(`🔑 Nova key gerada para: ${username || userId}`);
        
        res.json({
            success: true,
            key: apiKey,
            expiresIn: 1800, // 30 minutos em segundos
            expiresAt: new Date(Date.now() + 1800000).toISOString(),
            message: 'API Key gerada com sucesso!'
        });
        
    } catch (error) {
        console.error('❌ Erro ao gerar key:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Deletar API Key
app.post('/api/key/delete', (req, res) => {
    try {
        const { key } = req.body;
        
        if (!key) {
            return res.status(400).json({ success: false, error: 'Key não fornecida' });
        }
        
        const hash = hashKey(key);
        const deleted = apiKeys.delete(hash);
        
        console.log(`🗑️  Key deletada: ${deleted ? 'Sim' : 'Não'}`);
        
        res.json({ success: true, deleted });
        
    } catch (error) {
        console.error('❌ Erro ao deletar key:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Exportar
app.post('/api/export', async (req, res) => {
    try {
        const { apiKey, data, format, name, description, publishToMarketplace, assetType } = req.body;
        
        if (!apiKey || !data) {
            return res.status(400).json({ success: false, error: 'Dados incompletos (apiKey e data são obrigatórios)' });
        }
        
        // Valida API Key
        const validKey = getKey(apiKey);
        if (!validKey) {
            return res.status(401).json({ success: false, error: 'API key inválida ou expirada' });
        }
        
        // Renova a key
        storeKey(apiKey);
        
        console.log(`📤 Exportando: ${name || 'Sem nome'}`);
        
        // Cria o arquivo
        const fileContent = createRBXMX(data);
        const fileBuffer = Buffer.from(fileContent);
        const fileName = `${name || 'export'}_${Date.now()}.${format || 'rbxmx'}`;
        
        const result = {
            success: true,
            downloadUrl: `${req.protocol}://${req.get('host')}/download/${fileName}`,
            filePath: `/storage/emulated/0/Download/${fileName}`,
            fileName,
            fileData: fileBuffer.toString('base64'),
            fileSize: fileBuffer.length,
            timestamp: new Date().toISOString()
        };
        
        // Upload para Roblox (se solicitado)
        if (publishToMarketplace) {
            console.log(`📦 Publicando no Marketplace...`);
            const uploadResult = await uploadToRoblox(
                validKey,
                fileBuffer,
                assetType || 'Model',
                name,
                description
            );
            
            if (uploadResult.success) {
                result.assetId = uploadResult.assetId;
                result.marketplaceUrl = `https://www.roblox.com/library/${uploadResult.assetId}`;
                console.log(`✅ Publicado! Asset ID: ${uploadResult.assetId}`);
            } else {
                result.publishError = uploadResult.error;
                console.log(`❌ Erro ao publicar: ${uploadResult.error}`);
            }
        }
        
        res.json(result);
        console.log(`✅ Exportação completa: ${fileName}`);
        
    } catch (error) {
        console.error('❌ Erro na exportação:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Importar
app.post('/api/import', async (req, res) => {
    try {
        const { apiKey, source, sourceValue, format } = req.body;
        
        if (!apiKey || !source || !sourceValue) {
            return res.status(400).json({ success: false, error: 'Dados incompletos' });
        }
        
        // Valida API Key
        const validKey = getKey(apiKey);
        if (!validKey) {
            return res.status(401).json({ success: false, error: 'API key inválida ou expirada' });
        }
        
        // Renova a key
        storeKey(apiKey);
        
        console.log(`📥 Importando de: ${source}`);
        
        let fileBuffer;
        
        if (source === 'url') {
            const response = await axios.get(sourceValue, { responseType: 'arraybuffer' });
            fileBuffer = Buffer.from(response.data);
        } else if (source === 'assetId') {
            const response = await axios.get(
                `https://assetdelivery.roblox.com/v1/asset/?id=${sourceValue}`,
                { responseType: 'arraybuffer' }
            );
            fileBuffer = Buffer.from(response.data);
        } else if (source === 'file') {
            fileBuffer = Buffer.from(sourceValue, 'base64');
        } else {
            throw new Error('Fonte inválida. Use: url, assetId ou file');
        }
        
        console.log(`✅ Importação completa: ${fileBuffer.length} bytes`);
        
        res.json({
            success: true,
            data: fileBuffer.toString('base64'),
            format: format || 'rbxm',
            size: fileBuffer.length,
            timestamp: new Date().toISOString(),
            message: 'Importação processada com sucesso'
        });
        
    } catch (error) {
        console.error('❌ Erro na importação:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ===================================================
// TRATAMENTO DE ERROS
// ===================================================

app.use((err, req, res, next) => {
    console.error('❌ Erro:', err);
    res.status(500).json({ 
        success: false, 
        error: 'Erro interno do servidor',
        message: err.message 
    });
});

app.use((req, res) => {
    res.status(404).json({ 
        success: false, 
        error: 'Endpoint não encontrado',
        path: req.path
    });
});

// ===================================================
// INICIAR SERVIDOR
// ===================================================

app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════╗
║                                                    ║
║     🎮  ROBLOX IMPORT/EXPORT SERVER  🎮           ║
║                                                    ║
║     Status: ✅ ONLINE                              ║
║     Porta:
