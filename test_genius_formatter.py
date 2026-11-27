"""Regression examples for artist-supplied Genius transcriptions."""

import unittest

from genius_formatter import prepare_genius, render_genius


def draft(text, proposed=None):
    return render_genius(prepare_genius(text.strip().splitlines(), ""), proposed)["text"]


class GeniusFormatterTests(unittest.TestCase):
    def test_artist_cue_repeat_and_parenthesized_ending(self):
        text = """[куплет artist_a]:

Мы вышли на улицу.

И город проснулся,

artist016:

В окне загорается свет.

Слышишь мой голос?
Это наш новый день.

Слышишь мой голос?
Это наш новый день.

(Ну вот и всё.
Увидимся в городе.)"""
        result = draft(text, [{"line": 5, "kind": "pre-chorus"}])
        self.assertEqual(result, """[Куплет 1: artist_a]
Мы вышли на улицу
И город проснулся

[Куплет 2: artist016]
В окне загорается свет

[Припев]
Слышишь мой голос?
Это наш новый день
Слышишь мой голос?
Это наш новый день

[Аутро]
(Ну вот и всё
Увидимся в городе)""")

    def test_preserves_authored_labels_and_expressive_punctuation(self):
        text = """[Куплет]
Я вышел во двор,

[Хук]
Слышишь? (Я здесь.)

[Пред-припев]
Пока горит свет...

[Куплет]
Вижу огни, иду домой.
Говоришь: «Идём.»"""
        self.assertEqual(draft(text), """[Куплет]
Я вышел во двор

[Хук]
Слышишь? (Я здесь)

[Пред-припев]
Пока горит свет...

[Куплет]
Вижу огни, иду домой
Говоришь: «Идём»""")

    def test_plain_lyrics_do_not_become_intro(self):
        text = "Я вышел во двор.\nБыло ещё темно.\n\nВ окне погас свет."
        proposed = [{"line": 1, "kind": "intro"}, {"line": 4, "kind": "verse"}]
        result = draft(text, proposed)
        self.assertNotIn("[Интро]", result)
        self.assertEqual(result.count("[Куплет]"), 1)

    def test_inline_voice_cues_work_without_a_separate_roster(self):
        text = """[Куплет]
Ада: Первая строка
Боря: Вторая строка
Ада & Боря: Вместе"""
        self.assertEqual(draft(text), """[Куплет: Ада, <i>Боря</i> & <b>Ада & Боря</b>]
Первая строка
<i>Вторая строка</i>
<b>Вместе</b>""")

    def test_performer_list_in_source_is_used_as_metadata(self):
        text = """[Исполнители: шум]
[Текст трека Шум — «Ночь»]

[Куплет]
шум: В городе ночь"""
        result = draft(text)
        self.assertEqual(result, """[Текст трека Шум — «Ночь»]

[Куплет: шум]
В городе ночь""")

    def test_colons_inside_lyrics_remain_in_the_lyrics(self):
        text = """[Куплет]
Говоришь: «Идём»
Смотри: Погас свет
Мой друг: однажды ты вернёшься
В городе ночь"""
        self.assertEqual(draft(text), text)

    def test_inline_cues_survive_without_a_model_outline(self):
        text = "Ада: Первая строка\nБоря: Вторая строка"
        self.assertEqual(draft(text), "[Куплет: Ада & <i>Боря</i>]\nПервая строка\n<i>Вторая строка</i>")


if __name__ == "__main__":
    unittest.main()
