const { Router } = require('express');
const auth = require('../middleware/auth');
const friendsController = require('../controllers/friendsController');

const router = Router();

router.get('/', auth, friendsController.listFriends);
router.get('/requests', auth, friendsController.listRequests);
router.post('/request/:userId', auth, friendsController.sendRequest);
router.post('/respond/:requestId', auth, friendsController.respondRequest);

module.exports = router;