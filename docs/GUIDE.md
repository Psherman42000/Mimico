# Mimico — Guia de Configuração e Uso

Guia passo a passo para configurar e usar o Mimico no seu PC.

---

## Índice

1. [Instalação](#1-instalação)
2. [Primeira Execução](#2-primeira-execução)
3. [Gravação da Voz](#3-gravação-da-voz)
4. [Configurações](#4-configurações)
5. [Uso Diário](#5-uso-diário)
6. [Fallback para API](#6-fallback-para-api-paga)
7. [Solução de Problemas](#7-solução-de-problemas)

---

## 1. Instalação

### 1.1 Pré-requisitos

- Windows 10 ou 11
- [VB-Cable](https://vb-audio.com/Cable/) (grátis) — instalar antes
- Python 3.10+ com pip
- Node.js 18+

### 1.2 Instalar VB-Cable

1. Acesse https://vb-audio.com/Cable/
2. Baixe o instalador (doação opcional, clique "Download")
3. Execute e siga "Next > Next > Finish"
4. Verifique se aparece "CABLE Input" e "CABLE Output" no mixer de áudio do Windows

### 1.3 Instalar dependências Python

```bash
pip install faster-whisper sounddevice numpy edge-tts
```

### 1.4 Instalar o Mimico

```bash
# Clone o repositório
git clone https://github.com/Psherman42000/Mimico.git
cd Mimico

# Instalar dependências Node.js
npm install

# Build
npm run build
```

---

## 2. Primeira Execução

```bash
npm start
```

O ícone do Mimico aparece na bandeja do sistema (ao lado do relógio). Clique com botão direito para ver o menu.

### Na primeira execução:

1. ⚙️ O app abre a tela de configurações automaticamente
2. 🔑 Insira sua **DeepL API Key** (grátis em deepl.com)
3. 🎤 Grave sua voz para clonagem

---

## 3. Configuração do TTS

O Mimico suporta dois provedores de síntese de voz:

### Edge TTS (Padrão — Gratuito)
- **Custo:** $0, sem API key, sem cadastro
- **Vozes:** Microsoft Neural TTS — pt-BR (Francisca, Antonio), EN-US (Jenny, Aria, Guy), EN-GB, ES, FR, DE
- **Latência:** ~1s
- **Requer:** `pip install edge-tts`

### ElevenLabs (Premium)
- **Custo:** Starter $5/mo+
- **Vozes:** Centenas, suporte a voice cloning
- **Latência:** ~500ms (Flash v2.5)
- **Requer:** API key (configurada no painel)

### Como trocar a voz do Edge TTS
1. Abra Configurações (clique no ícone da bandeja > Configurações)
2. Vá na seção "♫ Voz"
3. Selecione a voz desejada no dropdown "Voz Edge TTS"
4. A voz é salva automaticamente

As vozes disponíveis incluem:
- `pt-BR-FranciscaNeural` — Feminino, PT-BR
- `pt-BR-AntonioNeural` — Masculino, PT-BR
- `en-US-JennyNeural` — Feminino, EN-US (padrão)
- `en-US-AriaNeural` — Feminino, EN-US
- `en-US-GuyNeural` — Masculino, EN-US
- `en-GB-SoniaNeural` — Feminino, EN-GB
- `en-GB-RyanNeural` — Masculino, EN-GB

---

## 4. Configurações

### Tela de Configurações

| Opção | Descrição | Padrão |
|---|---|---|---|
| **DeepL API Key** | Chave da API DeepL (grátis) | — |
| **Provedor TTS** | Edge (gratuito) ou ElevenLabs (pago) | `edge` |
| **Voz Edge TTS** | Voz específica do Edge (ex: pt-BR-AntonioNeural) | `en-US-JennyNeural` |
| **ElevenLabs Key** | Chave da API ElevenLabs | — |
| **ElevenLabs Voice ID** | ID da voz ElevenLabs | — |
| **ElevenLabs Model** | Modelo ElevenLabs (Flash, Turbo, Multilingual) | `eleven_flash_v2_5` |
| **Idioma origem** | Idioma do áudio capturado | `EN` |
| **Idioma destino** | Idioma da tradução | `PT` |
| **VB-Cable** | Nome do dispositivo VB-Cable | `CABLE Input` |
| **Whisper** | Tamanho do modelo (tiny → large) | `tiny` |
| **Hotkey toggle** | Atalho para ligar/desligar pipeline | `Alt+Shift+M` |
| **Hotkey overlay** | Atalho para mostrar/esconder overlay | `Alt+Shift+O` |
| **Opacidade** | Transparência do overlay | `0.85` |

---

## 5. Uso Diário

### Funcionalidades

#### ▶️ Transcrição + Tradução (sempre ativo)
Assim que o app inicia, ele começa a capturar áudio do sistema. Quando detecta fala em inglês, transcreve e traduz automaticamente. O resultado aparece na overlay.

#### 🎤 Toggle de Voz Traduzida
Clique no botão 🎤 na overlay para ativar. Quando ativo:
- O que você falar em português (no seu microfone) é **traduzido para inglês**
- O áudio é gerado com Edge TTS (voz selecionada nas configurações)
- O áudio é injetado no VB-Cable
- Apps como Meet/Discord capturam o VB-Cable como seu microfone

#### 🔇 Overlay Invisível
A janela do Mimico **não aparece em gravações de tela** (OBS, Meet, Discord, etc.). Só você vê.

#### 🖱️ Interagindo com a Overlay
- **Arraste**: clique e segure em qualquer lugar para mover
- **Toggle voz**: clique no ícone 🎤 para ativar/desativar
- **Fechar**: o app continua rodando na bandeja

---

## 6. Fallback para API Paga (ElevenLabs)

Se você quiser vozes mais naturais ou clonagem de voz, configure o ElevenLabs.

### Como configurar

1. Abra Configurações
2. Na seção "♫ Voz", mude o Provedor TTS para "ElevenLabs"
3. Insira sua API Key e ID da voz
4. A configuração é salva automaticamente

---

## 7. Solução de Problemas

| Problema | Causa Provável | Solução |
|---|---|---|
| Overlay não aparece | App minimizado na bandeja | Clique no ícone da bandeja |
| Overlay aparece em gravação | Driver de vídeo desatualizado | Atualizar driver NVIDIA |
| Sem transcrição | Microfone de entrada errado | Verificar dispositivo de áudio no Windows |
| Whisper muito lento | CPU sem GPU | Usar modelo `tiny` |
| Edge TTS não funciona | edge-tts não instalado | `pip install edge-tts` |
| ElevenLabs erro | Chave inválida ou cota excedida | Verificar plano em elevenlabs.io |
| VB-Cable não aparece | Driver não instalado | Instalar VB-Cable e reiniciar |
| DeepL erro | Chave inválida ou cota excedida | Verificar chave em deepl.com |
| App não inicia | Porta ocupada | Verificar se já está rodando |

### Logs

Os logs ficam em:
```
%APPDATA%/Mimico/logs/
```

Inclua esses logs ao reportar bugs.

---

## Atalhos de Teclado

| Atalho | Ação |
|---|---|
| `Alt+Shift+M` | Ligar/Desligar pipeline |
| `Alt+Shift+O` | Mostrar/Ocultar overlay |
| `Ctrl+B` | Stealth mode (tap toggle, hold fade) |

---

## Configuração do Meet / Discord

### Para usar o VB-Cable como microfone:

**Google Meet:**
1. Abra Meet > Configurações > Áudio
2. Microfone: selecione "CABLE Output"
3. Mantenha caixa de som padrão

**Discord:**
1. Abra Discord > Configurações > Voz e Vídeo
2. Dispositivo de entrada: "CABLE Output"
3. Dispositivo de saída: padrão

> **Importante:** Com o toggle de voz ativado, o VB-Cable envia o áudio traduzido. Você não escuta o que está sendo transmitido pelo VB-Cable (apenas a outra pessoa ouve).
