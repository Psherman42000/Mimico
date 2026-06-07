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
pip install faster-whisper openvoice sounddevice numpy
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

## 3. Gravação da Voz

Para usar o toggle de voz clonada, você precisa gravar sua voz primeiro.

### Como gravar:

1. Abra Configurações (clique no ícone da bandeja > Configurações)
2. Clique em "Gravar minha voz"
3. Leia o texto sugerido em português por ~30 segundos
4. Mantenha o ambiente silencioso
5. Clique em "Salvar"

A gravação é processada localmente e o embedding da sua voz é salvo no seu PC. Nada é enviado para a nuvem (a menos que você configure TTS via API).

---

## 4. Configurações

### Tela de Configurações

| Opção | Descrição | Padrão |
|---|---|---|
| **DeepL API Key** | Chave da API DeepL (grátis) | — |
| **Modo TTS** | Local (OpenVoice) ou API | `local` |
| **Provider TTS** | cartesia / fish / openai | `cartesia` |
| **API Key TTS** | Chave do provider escolhido | — |
| **Idioma origem** | Idioma do áudio capturado | `EN` |
| **Idioma destino** | Idioma da tradução | `PT-BR` |
| **Iniciar com Windows** | Auto-start | `off` |
| **Hotkey** | Atalho para mostrar/ocultar overlay | `Ctrl+Shift+M` |
| **Opacidade** | Transparência da overlay | `80%` |

---

## 5. Uso Diário

### Funcionalidades

#### ▶️ Transcrição + Tradução (sempre ativo)
Assim que o app inicia, ele começa a capturar áudio do sistema. Quando detecta fala em inglês, transcreve e traduz automaticamente. O resultado aparece na overlay.

#### 🎤 Toggle de Voz Clonada
Clique no botão 🎤 na overlay para ativar. Quando ativo:
- O que você falar em português (no seu microfone) é **traduzido para inglês**
- O áudio é gerado com **sua voz clonada**
- O áudio é injetado no VB-Cable
- Apps como Meet/Discord capturam o VB-Cable como seu microfone

#### 🔇 Overlay Invisível
A janela do Mimico **não aparece em gravações de tela** (OBS, Meet, Discord, etc.). Só você vê.

#### 🖱️ Interagindo com a Overlay
- **Arraste**: clique e segure em qualquer lugar para mover
- **Toggle voz**: clique no ícone 🎤 para ativar/desativar
- **Fechar**: o app continua rodando na bandeja

---

## 6. Fallback para API Paga

Se o modo local (OpenVoice) estiver lento demais (>3s), você pode configurar uma API externa.

### Opções Disponíveis

| Provider | Preço | Clonagem | Latência |
|---|---|---|---|
| **Cartesia** | **$4/mês** (100k créditos) | ✅ Instant | ~500ms |
| **Fish.audio** | **$11/mês** (250k créditos) | ✅ Enhanced | ~800ms |
| **OpenAI TTS** | $0.015/1k chars | ❌ | ~500ms |

### Como configurar

1. Abra Configurações
2. Mude "Modo TTS" de "Local" para "API"
3. Selecione o provider (ex: "Cartesia")
4. Insira sua API Key
5. Clique "Salvar"

O app automaticamente testa a latência e sugere trocar se o modo local estiver acima de 3s.

---

## 7. Solução de Problemas

| Problema | Causa Provável | Solução |
|---|---|---|
| Overlay não aparece | App minimizado na bandeja | Clique no ícone da bandeja |
| Overlay aparece em gravação | Driver de vídeo desatualizado | Atualizar driver NVIDIA |
| Sem transcrição | Microfone de entrada errado | Verificar dispositivo de áudio no Windows |
| Whisper muito lento | CPU sem GPU | Usar modelo `tiny` ou ativar fallback API |
| Voz clonada robótica | Amostra de voz curta/difícil | Regravar com 30s+ em ambiente silencioso |
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
| `Ctrl+Shift+M` | Mostrar/Ocultar overlay |
| `Ctrl+Shift+T` | Testar latência do pipeline |
| `Ctrl+Shift+Q` | Sair do app |

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
