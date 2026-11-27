# PANDA MUSIC — Караоке-студия

Один релиз для **Windows и macOS**. Студия синхронизирует текст одного трека с вокалом, экспортирует построчные TTML и LRC, готовит два DOCX после проверки текста и оформляет секции песни для Genius.

![Редактор таймингов PANDA MUSIC с демонстрационным треком](docs/studio-screenshot.png)

## Запуск

Скачайте общий ZIP из GitHub Releases и распакуйте его целиком.

| Система | Файл запуска |
| --- | --- |
| Windows 10/11 x64 | `Launch PANDA MUSIC Karaoke - Windows.bat` |
| macOS 13.3 и новее, Apple Silicon и Intel | `Launch PANDA MUSIC Karaoke - Mac.command` |
| Linux x64 / ARM64, экспериментально | `sh "./Launch PANDA MUSIC Karaoke - Mac.command"` из папки студии |

При первом запуске скрипт автоматически загружает локальный Python 3.12, зависимости и текстовую модель. При первой автосинхронизации скачивается модель распознавания. Подробности в [START-HERE.txt](START-HERE.txt).

На Windows с NVIDIA и подходящим драйвером включаются WhisperX, выделение вокала и адаптивный размер пакета обработки. На остальных поддерживаемых системах используется faster-whisper int8 на процессоре. Он ставит метки по словам в исходном миксе. На Apple Silicon текстовая модель может использовать Metal. Объём оперативной памяти определяет размер текстовой модели.

Сервис слушает только `127.0.0.1:8001`. Треки, тексты, проекты и экспорт хранятся на компьютере. Обращения к поставщикам используются для загрузки зависимостей и моделей. Редакционные правила PANDA MUSIC встроены. Папка `docs/` может содержать локальную памятку лейбла, которая применяется дополнительно при её наличии.

## Авторы и лицензия

© 2026 PANDA MUSIC, изменения и дополнения. Основа проекта [LRCGen](https://github.com/final-wav/LRCGen) от final-wav и участников проекта. Код доступен по [GNU GPLv3](LICENSE). См. [авторство](NOTICE.md) и [политику использования](USAGE-POLICY.md).

Установщик использует [uv](https://github.com/astral-sh/uv), [faster-whisper](https://github.com/SYSTRAN/faster-whisper) и [llama.cpp](https://github.com/ggml-org/llama.cpp/releases/tag/b12811). Для профиля NVIDIA он загружает [PyTorch](https://pytorch.org/), [WhisperX](https://github.com/m-bain/whisperX) и [FFmpeg](https://github.com/GyanD/codexffmpeg/releases/tag/7.1.1). Для проверки текста он выбирает [Qwen3-4B GGUF](https://huggingface.co/Qwen/Qwen3-4B-GGUF) или [Qwen3-1.7B GGUF](https://huggingface.co/Qwen/Qwen3-1.7B-GGUF). Лицензия шрифта Onest находится в `static/fonts/Onest-OFL.txt`.
