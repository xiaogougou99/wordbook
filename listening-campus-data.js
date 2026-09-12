(() => {
  "use strict";

  const createdAt = "2026-09-13T12:43:00+08:00";
  const campusSentences = [
    ["001", "Most weekday menus are pretty repetitive.", "多数工作日的菜单都相当重复单调。"],
    ["002", "Would you take a moment to evaluate the clarity of the introduction?", "你能花点时间评估一下引言是否清楚吗？"],
    ["003", "Yes, I liked the format of the academic panel discussions.", "是的，我喜欢学术小组讨论这种形式。"],
    ["004", "The espresso machine here is acting up again.", "这里的意式浓缩咖啡机又出故障了。"],
    ["005", "Would you prefer a window seat or an aisle seat for our flight to the graduate student conference?", "去参加研究生学术会议的航班，你想坐靠窗还是靠过道的位置？"],
    ["006", "I put the dishes away already.", "我已经把餐具收好了。"],
    ["007", "Do you think we can squeeze in a quick rehearsal before class?", "你觉得我们能在上课前挤出时间快速排练一下吗？"],
    ["008", "The biology club finished cataloging the pond life.", "生物俱乐部已经完成了池塘生物的分类编目。"],
    ["009", "OK, I'm just polishing it a bit more.", "好的，我只是想再稍微润色一下。"],
    ["010", "Care to trade notes later?", "待会儿要不要交换一下笔记？"],
    ["011", "I'm not ready to jump through hoops for an optional seminar.", "我不想为了一个选修研讨会费尽周折。"],
    ["012", "The grill stays on much later.", "烤架会一直开到更晚。"],
    ["013", "Could you square away the semester registration forms?", "你能把本学期的注册表格处理妥当吗？"],
    ["014", "The printer in the student lounge has gone haywire.", "学生休息室里的打印机失灵了。"],
    ["015", "The school assembly was very engaging.", "学校集会非常吸引人。"],
    ["016", "A new venue!", "一个新场地！"],
    ["017", "Could you let me know if the lab space frees up?", "如果实验室空出来了，能告诉我吗？"],
    ["018", "Who will deliver our class presentation at the symposium?", "谁将在研讨会上代表我们班做展示？"],
    ["019", "The restaurant has a great ambiance.", "这家餐厅的氛围很好。"],
    ["020", "The store carries artisanal products.", "这家商店出售手工制作的产品。"],
    ["021", "We shouldn't make a fuss over the professor's feedback.", "我们不必对教授的反馈大惊小怪。"],
    ["022", "Do you think we should swap out the first example?", "你觉得我们应该替换掉第一个例子吗？"]
  ].map(([suffix, word, meaning]) => ({
    id: `listening-campus-20260913-${suffix}`,
    word,
    phonetic: "",
    part_of_speech: word.endsWith("!") && !word.includes(" ") ? "phrase" : "sentence",
    meaning,
    category: "campus_conversation",
    learning_status: "unknown",
    created_at: createdAt,
    audio: ""
  }));

  const existing = Array.isArray(window.LISTENING_WORDS) ? window.LISTENING_WORDS : [];
  window.LISTENING_WORDS = [...campusSentences, ...existing];
})();
