var express = require('express');
var serve_static = require('serve-static');
var http = require('http');
var fs = require('fs');
const { constants } = require('buffer');

//parh user.jso
var path_user = __dirname + '/config/user.json'
var path_message = __dirname + '/config/messages.json'

var connect_user = {}
var not_connect_user = []

var app = express();
// Activation du serveur statique
app.use(serve_static(__dirname + "/public"));

// Récupération du serveur http de l'application
var serveur = http.Server(app);

// Ecoute sur un seul port
serveur.listen(8080, function () {
    console.log("Serveur en écoute sur le port 8080");
});

// Gestion du temps réel
var io = require('socket.io').listen(serveur);


io.sockets.on('connection', function (socket) {
    console.log("Un client s'est connecté");//quand un nouvel user

    socket.join("Salon général"); //il rejoind le general

    socket.on('JeSuisLa', function (message) { //gere les user connecte
        connect_user[message + "," + get_image(message)] = Date.now()

    })

    socket.on('who_connected', function () { //renvoie les users connecte
        socket.emit('users_connected', connect_user)
    })

    socket.on('who_not_connected', function () { //renvoie les non connecte

        not_connect_user.splice(0, not_connect_user.length); //on vide le tableau
        const usersData = rafraichieJSONFile(path_user);//charge json

        usersData.users.forEach(user => {
            if (!(user.username + "," + user.image_path in connect_user)) {//si pas connecté

                not_connect_user.push(user.username + "," + user.image_path)
            }
        });


        socket.emit('users_not_connected', not_connect_user)
    })

    //on test le cookie (validité et date)
    socket.on('cookie', function (message) {
        var connexion = message.split(',');
        cookie_validate(connexion).then(valid => {
            if (valid) {
                socket.emit('connexion', 'ok;' + message); //si co ok, on lui envoie son cookie
            }
            else (
                socket.emit('ko_cookie', '')//sinon ko et login classique
            )
        });
    })

    socket.on("demande_salon", function (message) { //demande titre salon plus message salon actuel
        socket.emit("reponse_salon", get_salon(message))
    })


    //on test le login
    socket.on('login', function (message) {
        var connexion = message.split(',');
        login_validate(connexion).then(valid => {
            if (valid) {//si le login est valide
                var cookie = get_cookie(connexion[0]);//on recup le cookie
                socket.emit('connexion', 'ok;' + cookie + ',' + connexion[0]); //si co ok, on lui envoie son cookie

            }
            else {
                socket.emit('connexion', 'ko_login');//sinon erreure
            }
        });
    })

    //on test l'inscription
    socket.on('register', function (message) {
        var connexion = message.split(',')
        if (UserExiste(connexion[0])) {//si pseudo deja dans la liste
            socket.emit("ko_register", "pseudo dejà pris")
        }
        else {
            addUser(connexion[0], connexion[2], connexion[1], generateCookie(), dateDansTroisJours()) //sinon ajout à bdd
            socket.emit('connexion', 'ok;' + get_cookie(connexion[0]) + ',' + connexion[0]); //si co ok, on lui envoie son cookie
        }
    })

    //nouveau salon
    socket.on('new_salon', function (message) {
        var connexion = message.split(';')
        if (SalonExist(connexion[0].split(',')[0])) {//si pseudo deja dans la liste
            socket.emit("ko_salon", "ce salon existe deja")
        }
        else {
            const users = connexion[1].split(',')
            users.push(connexion[0].split(',')[1])
            if (!plus2uservalid(users, connexion[0].split(',')[0])) {//si pas 2 user ou pkus
                socket.emit("ko_salon", "pas assez d'utilisateur")
            }
            else {
                creerSalon(connexion[0].split(',')[0]) //creation salon
                users.forEach(user => {
                    ajouut_user_in_salon(user, connexion[0].split(',')[0])    //ajout user
                })
                socket.emit("ok_salon")

            }
        }
    })

    // Réception d'un message
    socket.on("chat message", (data) => {
        ajouterMessage(data.user, data.salon, data.message, data.heure)
        io.to(data.salon).emit("chat message", { user: data.user + "," + get_image(data.user), message: data.message, heure: data.heure }); // Diffusion du message à tous les clients connectés
    });

    socket.on("changer de salon", (data) => {

        // Supprimer le client de la room correspondant à l'ancien salon
        socket.leave(data.ancienSalon);

        // Ajouter le client à la room correspondant au nouveau salon
        socket.join(data.salon);
    });

    socket.on("user_of_salon", function (message) {
        socket.emit("user_of_salon", user_of_salon(message))
    })

    socket.on("quitter_salon", function (message) {

        quitterSalon(message.split(',')[0], message.split(',')[1])
        socket.emit("salon_quitté")
    })

    socket.on('disconnect', function () {
        console.log("Un client s'est déconnecté");
    });
});

function rafraichieJSONFile(filename) { //pour ne pas avoir le cache mais la deriere version
    delete require.cache[require.resolve(filename)];
    return require(filename);
}

//test si au moisn 2 user valid
function plus2uservalid(users, salon) {
    var x = 0
    const usersData = rafraichieJSONFile(path_user);//charge json
    users.forEach(username => {
        if (UserExiste(username)) {//si l'user existe
            usersData.users.forEach(user => {
                if (user.username == username) {
                    if (!user.salon.includes(salon)) {//si pas deja dans le salon
                        x = x + 1
                    }
                }
            });
        }
    })

    if (x >= 2) {
        return true
    }
    else {
        return false
    }
}

//verifie que le socket est valide
function cookie_validate(connection) {
    return new Promise((resolve, reject) => {
        fs.readFile(path_user, 'utf8', function (err, data) {
            if (err) throw err;
            var users = JSON.parse(data).users;
            users.forEach(user => {
                if (connection[1] == user.username) { //si user existe
                    var date = new Date();
                    var date2 = new Date(user.expiration_date)
                    if ((connection[0] == user.cookie) && (date < date2)) { //si cookie valide et date ok
                        resolve(true);
                    }
                }
            });
            resolve(false);
        });
    });
}

//genere un cookie de 32 lettre aeatoire
function generateCookie() {
    var cookie = "";
    var char = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (var i = 0; i < 32; i++) {
        cookie += char.charAt(Math.floor(Math.random() * char.length));
    }
    return cookie;
}

function dateDansTroisJours() { //:rencoie la date dans 3 jours pour cookie
    var date = new Date();
    date.setDate(date.getDate() + 3);
    var annee = date.getFullYear(); //on formate en jour
    var mois = (date.getMonth() + 1).toString().padStart(2, '0');
    var jour = date.getDate().toString().padStart(2, '0');
    return `${annee}-${mois}-${jour}`;
}

//retourne le cookie
function get_cookie(pseudo) {
    const users = JSON.parse(fs.readFileSync(path_user, 'utf8')).users;
    const user = users.find(u => u.username === pseudo); //cherche le pseudo dans le json
    if (user) {
        return user.cookie;
    } else {
        return null;
    }
}


//nouveau cookie on login
function update_cookie(username) {
    const usersData = rafraichieJSONFile(path_user);//charge json

    usersData.users.forEach(user => { //genere new et change date
        if (user.username == username) {
            user.cookie = generateCookie();
            user.expiration_date = dateDansTroisJours()
        }
    });


    fs.writeFileSync(path_user, JSON.stringify(usersData, null, 2));//ecrit dans le json

}


//finction check login et cree nouveau cookie
function login_validate(connection) {
    return new Promise((resolve, reject) => {
        fs.readFile(path_user, 'utf8', function (err, data) {
            if (err) throw err;
            var users = JSON.parse(data).users;
            users.forEach(user => {
                if (connection[0] == user.username && connection[1] == user.password) {//si pseudo et password oj
                    update_cookie(connection[0]); //creation cookie
                    resolve(true);
                }
            });
            resolve(false);
        });
    });
}

//clean connectd suser
function clean_user() {
    Object.keys(connect_user).forEach(user => {
        const temps = connect_user[user];
        if (Date.now() - temps > 50000) { //si pas connecte depuis plus de 5s
            delete connect_user[user]
        }
    });
}
setInterval(clean_user, 500);//on update tt les 3s

//ajout user
function addUser(username, password, imagePath, cookie, expirationDate) {

    const usersData = rafraichieJSONFile(path_user);//charge json

    const newUser = {//nouvel user
        username: username,
        password: password,
        image_path: imagePath,
        cookie: cookie,
        expiration_date: expirationDate,
        salon: ["Salon général"]

    };

    usersData.users.push(newUser);//ajout dans data

    fs.writeFileSync(path_user, JSON.stringify(usersData, null, 2));//ecris dans json

}

//test si pseudo presnet dans json
function UserExiste(username) {
    var x = false
    const usersData = rafraichieJSONFile(path_user);//charge json
    usersData.users.forEach(user => {
        if (username == user.username) {//si dans json

            x = true//return existe
        }
    });
    return x
}

//envoie liste salon
function get_salon(message) {
    var data = message.split(',')
    var username = data[0]
    var salon_actuel2 = ""


    var salon_actuel = data[1]
    if (salon_actuel && salon_actuel.includes('private')) { //si private test nom inverse (un salon mais titre different)
        var private = salon_actuel.split('_')
        salon_actuel2 = private[0] + '_' + private[2] + '_' + private[1]

    }


    var x = [], salons;
    const usersData = rafraichieJSONFile(path_user);//charge json
    usersData.users.forEach(user => {
        if (username == user.username) {//si dans json 

            salons = user.salon
        }
    });
    var i = 0;
    var z = 0;
    const usersData2 = rafraichieJSONFile(path_message);//charge json
    usersData2.salons.forEach(salon => {

        if (salons.includes(salon.nom)) {//si dans json

            if (salon.nom == salon_actuel || (salon_actuel2 != "" && salon_actuel2 == salon.nom)) { //si salon actuel (si private, cherche aussi l'inverse)
                var temps = salon
                temps.nom = salon_actuel //on change le nom si private inverse
                x.push(temps)
                z = i
                salon_actuel = "1" //on envoie que le premier salon si 0 (init)
            }
            else { //si pas salon actuel, on envoie que le nom
                x.push({ nom: salon.nom, messages: [] })
            }
            i = i + 1
        }

    });

    x = JSON.stringify(x)
    var y = { "salons": x }
    return [z, y]
}

function get_image(username) {
    var x = false
    const usersData = rafraichieJSONFile(path_user);//charge json
    usersData.users.forEach(user => {
        if (username == user.username) {//si dans json

            x = user.image_path
        }
    });
    return x
}

function ajouterMessage(nomUtilisateur, nomSalon, contenuMessage, heure) {
    let salons = rafraichieJSONFile(path_message);


    let salon = salons.salons.find((s) => s.nom === nomSalon);//get le salon

    if (salon) { //si bon salon, on ajoute dans json
        salon.messages.push({
            "nomUtilisateur": nomUtilisateur + "," + get_image(nomUtilisateur),
            "contenu": contenuMessage,
            "heure": heure
        });
    }

    fs.writeFileSync(path_message, JSON.stringify(salons)); //ecrire dans le fichier json

    //console.log(salon);
}

//ajout d'un salon
function creerSalon(nom) {
    const salonData = rafraichieJSONFile(path_message);//charge json

    const nouveauSalon = {//nouveau salon
        nom: nom,
        messages: []
    };

    salonData.salons.push(nouveauSalon);//ajout dans data

    fs.writeFileSync(path_message, JSON.stringify(salonData, null, 2));//ecris dans json
}

//test si le salon existe
function SalonExist(nom) {
    var private = nom.split("_")
    var nom2 = ""
    if (private[0] == "private") {
        nom2 = private[0] + "_" + private[2] + "_" + private[1] //test si salon privé existe deja
    }
    var x = false
    const salonData = rafraichieJSONFile(path_message);//charge json
    salonData.salons.forEach(salon => {
        if (nom == salon.nom || nom2 == salon.nom) {//si dans json

            x = true//return existe
        }
    });
    return x
}

function quitterSalon(username, nom_salon) {
    if (UserExiste(username) && SalonExist(nom_salon) && user_in_salon(username, nom_salon)) {
        const usersData = rafraichieJSONFile(path_user);//charge json

        usersData.users.forEach(user => { //genere new et change date
            if (user.username == username) {
                var salon2 = []
                user.salon.forEach(salon => {
                    if (salon != nom_salon) {
                        salon2.push(salon)
                    }
                })
                user.salon = salon2

            }
        });

        fs.writeFileSync(path_user, JSON.stringify(usersData, null, 2));//ecrit dans le json
    }
}

//ajout utilisateur dans un salon
function ajouut_user_in_salon(username, salon) {
    if (UserExiste(username) && SalonExist(salon) && !user_in_salon(username, salon)) {
        const usersData = rafraichieJSONFile(path_user);//charge json

        usersData.users.forEach(user => { //genere new et change date
            if (user.username == username) {
                user.salon.push(salon)

            }
        });

        fs.writeFileSync(path_user, JSON.stringify(usersData, null, 2));//ecrit dans le json
    }
}

function user_of_salon(nom_salon) {
    var x = []
    let data = rafraichieJSONFile(path_user); //on get the user
    data.users.forEach(user => {

        if (user_in_salon(user.username, nom_salon)) {
            x.push(user.username)
        }

    })
    return x
}

function user_in_salon(username, nom_salon) {
    var x = false
    let data = rafraichieJSONFile(path_user); //on get the user

    data.users.forEach(user => {

        if (user.username == username) {
            user.salon.forEach(salon => {
                if (salon == nom_salon) {
                    x = true
                }
            })
        }
    })
    return x
}