"""Regression tests for the boundaries of the lyric review marks."""

import unittest

from drug_review import _merge_marks, screen_lyrics
from lyrics_tools import review_result


class DrugReviewTests(unittest.TestCase):
    def test_administration_context_marks_only_the_term(self):
        rows = [
            "Этим типам рано подниматься, нужен драг под десна",
            "Драга за дёсну",
            "Врач посмотрел под десну",
        ]
        marks, _ = screen_lyrics(rows, "")
        self.assertEqual(
            [[(line[start:end], color) for start, end, color in spans] for line, spans in zip(rows, marks)],
            [[("драг", "red")], [("Драга", "red")], []],
        )

    def test_other_review_rules_still_use_their_own_context(self):
        rows = [
            "Курю сигарету",
            "Поменял колёса на машине",
            "Я глотал таблетки ночью",
            "Закинул колёса и меня торкнуло",
            "Кокаин",
        ]
        marks, _ = screen_lyrics(rows, "")
        self.assertEqual(
            [[(line[start:end], color) for start, end, color in spans] for line, spans in zip(rows, marks)],
            [
                [], [], [("таблетки", "yellow")],
                [("Закинул", "red"), ("колёса", "red"), ("торкнуло", "red")],
                [("Кокаин", "red")],
            ],
        )

    def test_ambiguous_context_does_not_delete_other_words(self):
        rows = [
            "Пора взять себе колёса",
            "Нужен драг под десна",
            "Купил хлеб и кокаин",
            "Закинул ключи возле героина",
            "Пью воду и думаю про лин",
            "На ярлыке кокаин. Меня торкнуло",
            "Купил вчера кокаин",
            "Курю траву",
            "Пью лин",
            "У меня фен и кокаин",
        ]
        marks, suggestions = screen_lyrics(rows, "")
        self.assertEqual(
            [[(line[start:end], color) for start, end, color in spans] for line, spans in zip(rows, marks)],
            [
                [("колёса", "yellow")], [("драг", "red")], [("кокаин", "red")], [("героина", "red")],
                [("лин", "yellow")], [("кокаин", "red"), ("торкнуло", "yellow")],
                [("Купил", "red"), ("кокаин", "red")], [("Курю", "red"), ("траву", "red")],
                [("Пью", "red"), ("лин", "red")], [("фен", "yellow"), ("кокаин", "red")],
            ],
        )
        self.assertIn((1, "колёса"), {(item["line"], item["text"]) for item in suggestions})

    def test_overlapping_marks_keep_their_own_boundaries(self):
        self.assertEqual(
            _merge_marks([(0, 10, "yellow"), (3, 6, "red"), (4, 8, "red")]),
            [(0, 3, "yellow"), (3, 8, "red"), (8, 10, "yellow")],
        )

    def test_clean_removes_only_red_marked_words(self):
        ambiguous = "Что-то мешаю, ведь они пиздят, дают обещания"
        result = review_result(["Нужен драг под десна", "Я глотал таблетки ночью", ambiguous], "", "Проверка")
        original, clean = result["documents"]
        self.assertEqual(original["lines"][0], [("Нужен ", False), ("драг", "red"), (" под десна", False)])
        self.assertIn(("мешаю", "yellow"), original["lines"][2])
        self.assertEqual(clean["lines"], [[("Нужен под десна", False)], [("Я глотал таблетки ночью", False)], [(ambiguous, False)]])

    def test_uncertain_preparation_and_use_require_a_suspicious_context(self):
        cases = {
            "Мешаю что-то вечером": [("Мешаю", "yellow")],
            "Что-то варю": [("варю", "yellow")],
            "Фасую какую-то смесь": [("Фасую", "yellow")],
            "Подмешал кое-что": [("Подмешал", "yellow")],
            "Чем-то закинулся": [("закинулся", "yellow")],
            "Мне нужен кокаен": [("кокаен", "yellow")],
            "Что-то мешаю на кухне, варю суп": [],
            "Варю кашу": [],
            "Смешиваю краску": [],
            "Мне что-то мешает уснуть": [],
            "Мне что-то мешает": [],
            "Мешаю кокаин": [("Мешаю", "red"), ("кокаин", "red")],
        }
        for line, expected in cases.items():
            with self.subTest(line=line):
                marks, suggestions = screen_lyrics([line], "")
                self.assertEqual([(line[start:end], color) for start, end, color in marks[0]], expected)
                self.assertEqual([item["text"] for item in suggestions], [text for text, color in expected if color == "yellow"])
