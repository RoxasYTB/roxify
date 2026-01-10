import { embedColor } from '../../config/config.js';
import triggerErrorEmbed from '../../utils/triggerErrorEmbed.js';

async function createquote(message) {
  try {
    const randomQuotes = [
      "L'amour, c'est comme une bière, savoure-le, mais attention à la cuite !",
      'Les meilleures choses de la vie sont gratuites, mais les croustillantes se cachent sous un drap... ou dans un lit !',
      'La vie est un dessert, et il faut se lécher les doigts après un bon repas !',
      "Les secrets d'un bon mariage ? Un peu de folie, beaucoup de chocolat, et des câlins !",
      "Le désir, c'est un plat froid, mais un réchauffement au micro-ondes, ça fait du bien !",
      "Les rendez-vous galants, c'est comme des pizzas, même ratés, c'est un peu bon !",
      "L'amour, c'est un jeu, et je parie mes sous-vêtements... mais pas mes chaussettes !",
      'Les caresses, comme des promesses, il faut les tenir pour éviter les malentendus !',
      "La passion, c'est un feu, attention à ne pas se brûler les ailes !",
      'Les mots doux, comme des bonbons, ça fait plaisir, mais trop de sucre, ça fait mal au ventre !',
      'Les plaisirs de la vie, comme des chaussettes, change-les régulièrement pour éviter les odeurs !',
      "Le flirt, c'est un art, et je suis un Picasso... parfois, je fais des gribouillis !",
      "Les câlins, comme des bonbons, c'est meilleur quand on les partage !",
      "L'humour, c'est la clé de tout, surtout pour déverrouiller le cœur !",
      'Les rendez-vous amoureux, comme des films, apprécie le spectacle et les popcorns !',
      'Les compliments, comme des fleurs, offerts avec soin, attention aux allergies !',
      "La séduction, c'est un jeu d'échecs, anticipe les mouvements de l'autre !",
      'Les baisers, comme des promesses, sincères pour être savoureux !',
      'Les rires partagés, le meilleur aphrodisiaque, surtout après quelques verres !',
      "L'amour, c'est un voyage, et ma valise est toujours prête pour un week-end !",
    ];
    const ref = message.reference ? await message.fetchReference() : null;
    const refContent = ref?.content
      .split('\n')[0]
      .replace(/:\w+|<@!?(\d+)>|<@&\d+>|<#\d+>|#\w+(\s|$)|\b\d{1,}\b/g, '')
      .trim();
    const msg =
      refContent ||
      randomQuotes[Math.floor(Math.random() * randomQuotes.length)];
    const m = ref ? ref.member : message.member,
      { username, displayName, id, avatar } = m.user;
    const img = `http://localhost:9872/quote/${encodeURIComponent(msg.replace(/%20/g, '%C2%A0'))}/${encodeURIComponent(displayName)}/${encodeURIComponent(username)}/${id}/${encodeURIComponent(avatar)}`;
    await message.channel.send({
      embeds: [
        {
          color: embedColor,
          image: {
            url: `attachment://quote.webp`,
          },
        },
      ],
      files: [
        {
          attachment: img,
          name: 'quote.webp',
        },
      ],
    });
  } catch (e) {
    triggerErrorEmbed(
      e,
      message.client?.user?.username,
      message.client?.user?.displayAvatarURL(),
    );
  }
}

export { createquote };

