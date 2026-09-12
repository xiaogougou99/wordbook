(() => {
  "use strict";

  const campusGroups = [
    [{ id: "campus-20260913-expertise", w: "expertise", p: "n.", m: "专业知识；专门技能", i: "/ˌekspɜːrˈtiːz/", main: true }],
    [{ id: "campus-20260913-syllabus", w: "syllabus", p: "n.", m: "教学大纲；课程大纲", i: "/ˈsɪləbəs/", main: true }],
    [{ id: "campus-20260913-attire", w: "attire", p: "n.", m: "服装；衣着（较正式）", i: "/əˈtaɪər/", main: true }],
    [{ id: "campus-20260913-extracurricular", w: "extracurricular", p: "adj.", m: "课外的；课余的", i: "/ˌekstrəkəˈrɪkjələr/", main: true }],
    [{ id: "campus-20260913-symposium", w: "symposium", p: "n.", m: "专题研讨会；学术研讨会", i: "/sɪmˈpoʊziəm/", main: true }],
    [{ id: "campus-20260913-preparatory-course", w: "preparatory course", p: "n. phr.", m: "预备课程；预科课程", i: "/prɪˈpærətɔːri kɔːrs/", main: true }],
    [{ id: "campus-20260913-long-shot", w: "long shot", p: "n. phr.", m: "胜算很小的尝试；希望渺茫的事", i: "/ˌlɔːŋ ˈʃɑːt/", main: true }],
    [{ id: "campus-20260913-introductory-course", w: "introductory course", p: "n. phr.", m: "入门课程；导论课", i: "/ˌɪntrəˈdʌktəri kɔːrs/", main: true }],
    [{ id: "campus-20260913-swap", w: "swap", p: "v. / n.", m: "交换；调换；替换", i: "/swɑːp/", main: true }],
    [{ id: "campus-20260913-optimal", w: "optimal", p: "adj.", m: "最佳的；最理想的", i: "/ˈɑːptɪməl/", main: true }],
    [{ id: "campus-20260913-refrain-from", w: "refrain from", p: "phr. v.", m: "克制；避免做……", i: "/rɪˈfreɪn frəm/", main: true }],
    [{ id: "campus-20260913-etiquette", w: "etiquette", p: "n.", m: "礼仪；礼节", i: "/ˈetɪkət/", main: true }],
    [{ id: "campus-20260913-credentials", w: "credentials", p: "n. pl.", m: "资格；资历；资格证书", i: "/krəˈdenʃəlz/", main: true }],
    [{ id: "campus-20260913-publicity", w: "publicity", p: "n.", m: "宣传；媒体关注；公众关注", i: "/pʌbˈlɪsəti/", main: true }]
  ];

  const existingGroups = Array.isArray(window.WORD_GROUPS) ? window.WORD_GROUPS : [];
  const existingRegistry = Array.isArray(window.WORD_ID_REGISTRY) ? window.WORD_ID_REGISTRY : [];
  const campusIds = campusGroups.flat().map((entry) => entry.id);

  window.WORD_GROUPS = [...campusGroups, ...existingGroups];
  window.WORD_ID_REGISTRY = [...existingRegistry, ...campusIds];
})();
