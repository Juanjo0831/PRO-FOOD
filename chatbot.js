// -------------------------------------------------------------------
// CONFIGURACIÓN E INICIALIZACIÓN DE LA APLICACIÓN
// -------------------------------------------------------------------
// Inicialización de Lucide Icons
lucide.createIcons();

// Variables de la Interfaz
const chatContainer = document.getElementById('profood-chat');
const chatHistory = document.getElementById('chat-history');
const userInput = document.getElementById('user-input');
const sendButton = document.getElementById('send-button');
const loadingIndicator = document.getElementById('loading-indicator');
const audioLoadingIndicator = document.getElementById('audio-loading-indicator');

// Configuración de la API de Gemini
const apiKey = ""; // La clave se manejará automáticamente en el entorno

// Endpoints
const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
const ttsApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`;

// Sistema de Instrucción para el Asistente Nutricional PROFOOD
const systemPrompt = "Actúa como un asistente nutricional llamado PROFOOD. Proporciona información concisa, precisa y basada en datos de Google Search sobre alimentos, dietas, y recetas saludables. Mantén un tono amigable, profesional y usa formato Markdown. Siempre proporciona las fuentes de información al final de tu respuesta.";

let isSending = false; // Bandera para evitar envíos múltiples
let currentAudio = null; // Para almacenar el objeto Audio en reproducción

// Habilita el botón de envío si hay texto
userInput.addEventListener('input', () => {
    sendButton.disabled = userInput.value.trim() === '' || isSending;
});

// -------------------------------------------------------------------
// UTILIDADES DE AUDIO (PCM a WAV)
// -------------------------------------------------------------------

/**
 * Convierte una cadena Base64 en un ArrayBuffer.
 * @param {string} base64 - Cadena Base64.
 * @returns {ArrayBuffer}
 */
function base64ToArrayBuffer(base64) {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

/**
 * Convierte datos PCM (Int16Array) a un Blob de archivo WAV.
 * @param {Int16Array} pcmData - Datos PCM firmados de 16 bits.
 * @param {number} sampleRate - Tasa de muestreo.
 * @returns {Blob}
 */
function pcmToWav(pcmData, sampleRate) {
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const dataSize = pcmData.byteLength;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    let offset = 0;

    function writeString(s) {
        for (let i = 0; i < s.length; i++) {
            view.setUint8(offset + i, s.charCodeAt(i));
        }
        offset += s.length;
    }

    // RIFF chunk
    writeString('RIFF');
    view.setUint32(offset, 36 + dataSize, true); offset += 4;
    writeString('WAVE');

    // fmt chunk
    writeString('fmt ');
    view.setUint32(offset, 16, true); offset += 4; // Sub-chunk size
    view.setUint16(offset, 1, true); offset += 2; // Audio format (1=PCM)
    view.setUint16(offset, numChannels, true); offset += 2;
    view.setUint32(offset, sampleRate, true); offset += 4;
    view.setUint32(offset, byteRate, true); offset += 4;
    view.setUint16(offset, blockAlign, true); offset += 2;
    view.setUint16(offset, bitsPerSample, true); offset += 2;

    // data chunk
    writeString('data');
    view.setUint32(offset, dataSize, true); offset += 4;

    // PCM data (Int16Array)
    const pcmBytes = new Uint8Array(buffer, offset);
    pcmBytes.set(new Uint8Array(pcmData.buffer));

    return new Blob([view], { type: 'audio/wav' });
}


/**
 * Detiene cualquier audio en reproducción.
 */
function stopAudioPlayback() {
    if (currentAudio) {
        currentAudio.pause();
        currentAudio.src = ''; // Limpia la fuente
        currentAudio = null;
        // Ocultar indicador de carga de audio si estaba activo
        audioLoadingIndicator.classList.add('hidden');
    }
}


// -------------------------------------------------------------------
// FUNCIONES DE UI
// -------------------------------------------------------------------

/**
 * Alterna la visibilidad del contenedor del chat.
 */
window.toggleChat = function() {
    stopAudioPlayback(); // Detener audio al cerrar/abrir
    chatContainer.classList.toggle('scale-0');
    chatContainer.classList.toggle('scale-100');
    if (chatContainer.classList.contains('scale-100')) {
        userInput.focus();
        // Asegura que el historial de chat esté abajo
        chatHistory.scrollTop = chatHistory.scrollHeight;
    }
}

/**
 * Agrega un mensaje a la historia del chat.
 * @param {string} text - El contenido del mensaje.
 * @param {string} sender - 'user' o 'bot'.
 * @param {Array<Object>} sources - Array de fuentes para el bot.
 */
function addMessage(text, sender, sources = []) {
    const messageWrapper = document.createElement('div');
    messageWrapper.className = `flex ${sender === 'user' ? 'justify-end' : 'justify-start'}`;
    
    const messageBubble = document.createElement('div');
    messageBubble.className = `p-3 rounded-xl shadow-md max-w-[80%] ${
        sender === 'user' 
        ? 'bg-green-500 text-white rounded-br-none' 
        : 'bg-white text-gray-800 rounded-tl-none flex flex-col'
    }`;

    // Reemplazar saltos de línea con etiquetas <br> para HTML
    messageBubble.innerHTML = sender === 'bot' ? formatBotResponse(text, sources) : `<p class="text-sm">${text}</p>`;

    messageWrapper.appendChild(messageBubble);
    chatHistory.appendChild(messageWrapper);
    
    // Si es un mensaje de bot, añadir el botón de TTS al final de la burbuja
    if (sender === 'bot') {
        const ttsButton = document.createElement('button');
        ttsButton.className = 'mt-2 text-xs font-semibold text-green-700 bg-green-100 p-1 rounded-full hover:bg-green-200 transition duration-150 flex items-center justify-center w-full';
        ttsButton.innerHTML = '<i data-lucide="volume-2" class="w-3 h-3 inline mr-1"></i> 🔊 Leer Respuesta';
        ttsButton.onclick = () => readMessage(text, ttsButton);
        
        // Inicializar iconos para el botón recién creado
        lucide.createIcons({ attr: 'data-lucide', element: ttsButton });

        messageBubble.appendChild(ttsButton);
    }

    // Desplazamiento automático al final
    chatHistory.scrollTop = chatHistory.scrollHeight;
}

/**
 * Formatea la respuesta del bot para incluir fuentes.
 * @param {string} text - El texto del bot.
 * @param {Array<Object>} sources - Array de fuentes.
 * @returns {string} - HTML formateado.
 */
function formatBotResponse(text, sources) {
    // Usar una expresión regular simple para detectar si el texto contiene listas o encabezados
    // para formatear correctamente el markdown (aunque no es un parser completo de markdown)
    const formattedText = text
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') // Negritas
        .replace(/^- (.*)/gm, '<li>$1</li>') // Listas no ordenadas (inicio)
        .replace(/^(\d+)\. (.*)/gm, '<li>$1. $2</li>'); // Listas ordenadas (inicio)
    
    let html = `<div class="text-sm mb-1 whitespace-pre-wrap">${formattedText}</div>`;
    
    if (sources && sources.length > 0) {
        html += '<div class="mt-2 pt-2 border-t border-green-100">';
        html += '<p class="text-xs font-semibold text-green-600 mb-1">Fuentes de Google:</p>';
        sources.forEach((source, index) => {
            html += `<p class="text-xs text-green-700 truncate mb-1">
                <a href="${source.uri}" target="_blank" class="hover:underline">${index + 1}. ${source.title}</a>
            </p>`;
        });
        html += '</div>';
    }
    return html;
}

/**
 * Muestra/oculta el indicador de carga.
 * @param {boolean} show - Si mostrar (true) u ocultar (false).
 * @param {string} type - 'text' o 'audio'.
 */
function setLoading(show, type = 'text') {
    if (type === 'text') {
        isSending = show;
        loadingIndicator.classList.toggle('hidden', !show);
        sendButton.disabled = show || userInput.value.trim() === '';
        userInput.disabled = show;
    } else if (type === 'audio') {
        audioLoadingIndicator.classList.toggle('hidden', !show);
    }
}

// -------------------------------------------------------------------
// FUNCIONES DE LÓGICA DEL CHATBOT
// -------------------------------------------------------------------

/**
 * Envía el mensaje del usuario y obtiene la respuesta de Gemini (Texto).
 */
window.sendMessage = async function() {
    const query = userInput.value.trim();
    if (!query || isSending) return;

    // Detener cualquier audio anterior
    stopAudioPlayback();

    // 1. Mostrar mensaje del usuario
    addMessage(query, 'user');
    userInput.value = ''; // Limpiar input
    setLoading(true, 'text');

    try {
        // 2. Obtener respuesta del modelo
        const responseData = await fetchGeminiResponse(query);

        if (responseData && responseData.text) {
            // 3. Mostrar respuesta del bot con fuentes y botón TTS
            addMessage(responseData.text, 'bot', responseData.sources);
        } else {
            addMessage("Disculpa, no pude obtener una respuesta en este momento. Intenta de nuevo más tarde.", 'bot');
        }
    } catch (error) {
        console.error("Error al obtener respuesta de Gemini:", error);
        addMessage("Lo siento, ocurrió un error en la conexión. Por favor, verifica tu red o intenta más tarde.", 'bot');
    } finally {
        setLoading(false, 'text');
        userInput.focus();
    }
}

/**
 * Realiza la llamada a la API de Gemini con reintentos y retroceso exponencial (Texto).
 * @param {string} userQuery - La consulta del usuario.
 * @returns {Promise<{text: string, sources: Array<Object>}>} - Respuesta del modelo y fuentes.
 */
async function fetchGeminiResponse(userQuery) {
    const payload = {
        contents: [{ parts: [{ text: userQuery }] }],
        // Habilitar Google Search grounding para información nutricional actualizada
        tools: [{ "google_search": {} }],
        systemInstruction: {
            parts: [{ text: systemPrompt }]
        },
    };

    const MAX_RETRIES = 5;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        let delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s, 8s, 16s

        try {
            const response = await fetch(geminiApiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (response.status === 429 && attempt < MAX_RETRIES - 1) {
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }

            if (!response.ok) {
                throw new Error(`Error HTTP: ${response.status}`);
            }

            const result = await response.json();
            const candidate = result.candidates?.[0];

            if (candidate && candidate.content?.parts?.[0]?.text) {
                const text = candidate.content.parts[0].text;
                
                let sources = [];
                const groundingMetadata = candidate.groundingMetadata;
                if (groundingMetadata && groundingMetadata.groundingAttributions) {
                    sources = groundingMetadata.groundingAttributions
                        .map(attribution => ({
                            uri: attribution.web?.uri,
                            title: attribution.web?.title,
                        }))
                        .filter(source => source.uri && source.title);
                }

                return { text, sources };
            } else {
                throw new Error("Respuesta del modelo incompleta o vacía.");
            }

        } catch (error) {
            console.error(`Intento ${attempt + 1} fallido:`, error.message);
            if (attempt === MAX_RETRIES - 1) {
                throw error;
            }
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

/**
 * Realiza la llamada a la API de Gemini (TTS) y reproduce el audio.
 * @param {string} text - El texto a leer.
 * @param {HTMLButtonElement} button - El botón que disparó la acción.
 */
window.readMessage = async function(text, button) {
    stopAudioPlayback(); // Detener cualquier audio en curso
    
    button.disabled = true;
    const originalButtonText = button.innerHTML;
    button.innerHTML = '<i data-lucide="volume-2" class="w-3 h-3 inline mr-1 animate-pulse"></i> Cargando...';
    lucide.createIcons({ attr: 'data-lucide', element: button });
    setLoading(true, 'audio');

    const ttsPayload = {
        contents: [{ parts: [{ text: text }] }],
        generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
                voiceConfig: {
                    // Usamos una voz amigable y clara para el asistente
                    prebuiltVoiceConfig: { voiceName: "Kore" } 
                }
            }
        },
    };

    try {
        const response = await fetch(ttsApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(ttsPayload)
        });

        if (!response.ok) {
            throw new Error(`Error HTTP en TTS: ${response.status}`);
        }

        const result = await response.json();
        const part = result?.candidates?.[0]?.content?.parts?.[0];
        const audioData = part?.inlineData?.data;
        const mimeType = part?.inlineData?.mimeType;

        if (audioData && mimeType && mimeType.startsWith("audio/")) {
            const sampleRateMatch = mimeType.match(/rate=(\d+)/);
            if (!sampleRateMatch) throw new Error("Tasa de muestreo no encontrada en mimetype.");
            
            const sampleRate = parseInt(sampleRateMatch[1], 10);
            const pcmData = base64ToArrayBuffer(audioData);
            const pcm16 = new Int16Array(pcmData);
            const wavBlob = pcmToWav(pcm16, sampleRate);
            const audioUrl = URL.createObjectURL(wavBlob);
            
            currentAudio = new Audio(audioUrl);
            
            currentAudio.onended = () => {
                button.innerHTML = originalButtonText;
                lucide.createIcons({ attr: 'data-lucide', element: button });
                button.disabled = false;
                setLoading(false, 'audio');
                URL.revokeObjectURL(audioUrl);
            };

            currentAudio.onerror = (e) => {
                console.error("Error de reproducción de audio:", e);
                alertMessage("Error al reproducir el audio.");
                button.innerHTML = originalButtonText;
                lucide.createIcons({ attr: 'data-lucide', element: button });
                button.disabled = false;
                setLoading(false, 'audio');
                URL.revokeObjectURL(audioUrl);
            };
            
            currentAudio.play();
            button.innerHTML = '<i data-lucide="volume-2" class="w-3 h-3 inline mr-1 animate-bounce"></i> Escuchando...';
            lucide.createIcons({ attr: 'data-lucide', element: button });

        } else {
            throw new Error("Respuesta de audio incompleta o inválida.");
        }

    } catch (error) {
        console.error("Error en TTS:", error);
        alertMessage("No se pudo generar el audio. Inténtalo de nuevo.");
        button.innerHTML = originalButtonText;
        lucide.createIcons({ attr: 'data-lucide', element: button });
    } finally {
        setLoading(false, 'audio');
        button.disabled = false;
    }
}

/**
 * Simula un alert usando un mensaje simple en la consola.
 * (Se evita el uso de alert() debido a restricciones del iframe)
 */
function alertMessage(message) {
     console.log(`[ALERTA DE PROFOOD]: ${message}`);
}
